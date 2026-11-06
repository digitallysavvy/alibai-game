'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IAgoraRTCClient, IMicrophoneAudioTrack, IRemoteAudioTrack, IRemoteVideoTrack } from 'agora-rtc-sdk-ng'
import { sessionRequest, type SessionView } from '@/lib/game/api'
import { connectLiveTranscript, type LiveTranscript, type TranscriptLine, type TranscriptStatus } from '@/lib/agora/live-transcript'
import { startupMarks } from '@/lib/agora/startup-marks'

interface RtcCredentials {
  appId: string; channel: string; uid: number; rtcToken: string; rtmUid: string; rtmToken: string
  agentUid: number; avatarUid: number; expiresAt: number
}
type Phase = 'idle' | 'connecting' | 'waiting_media' | 'starting_clock' | 'live' | 'reconnecting' | 'ended' | 'error'

/** Media lifecycle adapted from the official Next.js ConversationComponent and RTC Web skill.
 * Live captions are display only. No transcript or fact leaves the browser: discovery remains
 * a trusted server responsibility, and captions take no part in the readiness gate.
 */
export function useSuspectVoice(sessionId: string, onReady: () => Promise<void>) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptStatus>('idle')
  const videoElement = useRef<HTMLDivElement | null>(null)
  const clientRef = useRef<IAgoraRTCClient | null>(null)
  const microphoneRef = useRef<IMicrophoneAudioTrack | null>(null)
  const audioRef = useRef<IRemoteAudioTrack | null>(null)
  const videoRef = useRef<IRemoteVideoTrack | null>(null)
  const transcriptRef = useRef<LiveTranscript | null>(null)
  const transcriptLines = useRef<TranscriptLine[]>([])
  const attempt = useRef(0)
  const active = useRef(false)
  const starting = useRef(false)
  const hasAgent = useRef(false)
  const readyCallback = useRef(onReady)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  readyCallback.current = onReady

  const releaseMedia = useCallback(async () => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    const microphone = microphoneRef.current; microphoneRef.current = null
    const client = clientRef.current; clientRef.current = null
    const liveTranscript = transcriptRef.current; transcriptRef.current = null
    // Started first so the toolkit detaches before the RTC listeners below are removed.
    const transcriptReleased = liveTranscript?.release()
    setTranscriptStatus('idle')
    audioRef.current?.stop(); audioRef.current = null
    videoRef.current?.stop(); videoRef.current = null
    if (microphone) { microphone.stop(); microphone.close() }
    if (client) { client.removeAllListeners(); await client.leave().catch(() => {}) }
    await transcriptReleased
  }, [])

  const disconnect = useCallback(async () => {
    ++attempt.current; starting.current = false; active.current = false
    await releaseMedia(); setPhase('ended')
  }, [releaseMedia])

  // Only a confirmed end clears hasAgent, so a failed or retried connection keeps the unmount cleanup.
  const endSession = useCallback(async () => {
    const view = await sessionRequest<SessionView>(sessionId, 'end', {})
    hasAgent.current = false
    return view
  }, [sessionId])

  const start = useCallback(async () => {
    if (starting.current || active.current) return
    starting.current = true
    const current = ++attempt.current
    const isCurrent = () => attempt.current === current
    setError(''); setPhase('connecting'); setMuted(false); setAudioBlocked(false)
    await releaseMedia()
    let agentRequested = false, agentFailed = false
    const marks = startupMarks()
    try {
      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default
      marks.mark('sdk-import')
      AgoraRTC.setLogLevel(3)
      const microphone = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig:'speech_standard', AEC:true, ANS:true, AGC:true })
      if (!isCurrent()) { microphone.stop(); microphone.close(); return }
      microphoneRef.current = microphone
      marks.mark('mic')
      const credentials = await sessionRequest<RtcCredentials>(sessionId, 'agent', {}).catch(error => { agentFailed = true; throw error })
      agentRequested = true; hasAgent.current = true
      marks.mark('agent-response')
      if (!isCurrent()) { await releaseMedia(); void endSession().catch(()=>{}); return }
      const client = AgoraRTC.createClient({ mode:'rtc', codec:'h264' })
      clientRef.current = client
      let audioDecoded = false, videoDecoded = false, published = false, ready = false, readyInFlight = false
      let failedAutoplay = false
      const markReady = async () => {
        if (!isCurrent() || ready || readyInFlight || !published || !audioDecoded || !videoDecoded || failedAutoplay) return
        readyInFlight = true
        // Media is playing, so the suspect shows now. Only the server's reply starts the clock.
        setPhase('starting_clock')
        try {
          await sessionRequest(sessionId, 'agent-ready', {})
          if (!isCurrent()) return
          ready = true; active.current = true; starting.current = false
          if(timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
          marks.mark('ready'); marks.report('ready')
          setPhase('live'); await readyCallback.current()
        } catch {
          if(isCurrent()) {
            // Leave nothing playing behind the error. The agent stays up for a retry, and
            // the refresh shows the true state if the server did start the clock.
            marks.report('failed')
            ++attempt.current; starting.current = false; active.current = false
            setError('The suspect connected, but the server could not confirm the interview clock. Please retry the connection.'); setPhase('error')
            await releaseMedia()
            await readyCallback.current().catch(() => {})
          }
        } finally { readyInFlight = false }
      }
      AgoraRTC.onAudioAutoplayFailed = () => { if(isCurrent()) { failedAutoplay = true; setAudioBlocked(true) } }
      const remoteRole = (uid: unknown) => Number(uid) === credentials.avatarUid ? 'avatar' : 'agent'
      client.on('user-joined', user => {
        if ([credentials.agentUid,credentials.avatarUid].includes(Number(user.uid))) marks.mark(`${remoteRole(user.uid)}-joined`)
      })
      // Register before join to catch tracks from the already-starting cloud agent.
      client.on('user-published', async (user, mediaType) => {
        if (!isCurrent() || (mediaType !== 'audio' && mediaType !== 'video')) return
        if (![credentials.agentUid,credentials.avatarUid].includes(Number(user.uid))) return
        if (mediaType === 'video' && Number(user.uid) !== credentials.avatarUid) return
        marks.mark(`${remoteRole(user.uid)}-published-${mediaType}`)
        try {
          await client.subscribe(user, mediaType)
          if(!isCurrent()) return
          if(mediaType === 'audio' && user.audioTrack) {
            // Prefer avatar-delayed audio if the avatar publishes it; never play both tracks.
            if(audioRef.current && Number(user.uid) !== credentials.avatarUid) return
            audioRef.current?.stop(); audioRef.current = user.audioTrack
            user.audioTrack.on('first-frame-decoded', () => { marks.mark(`${remoteRole(user.uid)}-decoded-audio`); audioDecoded = true; void markReady() })
            user.audioTrack.play()
          }
          if(mediaType === 'video' && user.videoTrack) {
            videoRef.current = user.videoTrack
            user.videoTrack.on('first-frame-decoded', () => { marks.mark(`${remoteRole(user.uid)}-decoded-video`); videoDecoded = true; void markReady() })
            if(videoElement.current) user.videoTrack.play(videoElement.current, { fit:'cover' })
          }
        } catch { if(isCurrent()) setError('A remote media track could not be opened. Check your connection and retry.') }
      })
      client.on('connection-state-change', state => {
        if(!isCurrent()) return
        if(state === 'RECONNECTING') setPhase('reconnecting')
        if(state === 'CONNECTED' && ready) setPhase('live')
        if(state === 'DISCONNECTED' && ready) { setPhase('error'); setError('The voice connection was lost. The server clock continues; reconnect or finish your verdict.') }
      })
      client.on('token-privilege-will-expire', () => {
        void sessionRequest<RtcCredentials>(sessionId,'agent',{}).then(async tokens=>{ await client.renewToken(tokens.rtcToken); await transcriptRef.current?.renewToken(tokens.rtmToken) }).catch(()=>setError('Connection credentials could not be renewed. Finish your interview and submit a verdict.'))
      })
      // Not awaited: captions run beside the join to catch the greeting, and can neither
      // delay nor fail the media path. A reconnect keeps the lines already on screen.
      const earlierLines = transcriptLines.current
      transcriptRef.current = connectLiveTranscript({
        rtcClient: client, appId: credentials.appId, channel: credentials.channel, rtmUid: credentials.rtmUid, rtmToken: credentials.rtmToken,
        onStatus: setTranscriptStatus,
        onLines: lines => {
          transcriptLines.current = [...earlierLines, ...lines.map(line => ({ ...line, id: `${current}-${line.id}` }))]
          setTranscript(transcriptLines.current)
        },
      })
      await client.join(credentials.appId, credentials.channel, credentials.rtcToken, credentials.uid)
      marks.mark('player-joined')
      if(!isCurrent()) { await releaseMedia(); return }
      await client.publish(microphone)
      marks.mark('mic-published')
      published = true; setPhase('waiting_media'); void markReady()
      // Decode is the readiness gate. The player gets an explicit retry if no media arrives.
      timeoutRef.current = setTimeout(() => {
        if(isCurrent() && !ready) { setError('The suspect’s audio and avatar did not connect in time. Your clock never started. Please request another case.'); setPhase('error'); starting.current = false; ++attempt.current; void releaseMedia(); void endSession().then(() => readyCallback.current()).catch(()=>{}) }
      }, 60000)
      // Replay from a fresh user gesture can release browser autoplay restrictions.
      resumeRef.current = () => { audioRef.current?.play(); failedAutoplay = false; setAudioBlocked(false); void markReady() }
    } catch (error) {
      if(isCurrent()) {
        marks.report('failed')
        starting.current = false; active.current = false; await releaseMedia(); setPhase('error')
        setError(agentFailed
          ? (error instanceof Error ? error.message : 'The suspect could not be reached. Your clock never started.')
          : 'Could not connect the interview. Allow microphone access, check your connection, and retry. Your case is saved.')
        if(agentRequested) await endSession().catch(()=>{})
        // A failed start abandons the session on the server; show the player the way out.
        if(agentRequested || agentFailed) await readyCallback.current().catch(()=>{})
      }
    }
  }, [sessionId, releaseMedia, endSession])

  const resumeRef = useRef<() => void>(() => {})
  const resumeAudio = useCallback(() => resumeRef.current(), [])
  const toggleMute = useCallback(async () => {
    const microphone = microphoneRef.current
    if(!microphone) return
    const next = !muted
    try { await microphone.setEnabled(!next); setMuted(next) }
    catch { setError('Microphone state could not be changed. Check browser permissions.') }
  }, [muted])
  useEffect(() => () => {
    ++attempt.current; starting.current = false; active.current = false
    void releaseMedia()
    transcriptLines.current = []; setTranscript([])
    // Best effort only. The cleanup worker is authoritative when tabs disappear.
    if(hasAgent.current) void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/end`, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},body:'{}',keepalive:true }).catch(()=>{})
  }, [sessionId,releaseMedia])

  return { phase,error,muted,audioBlocked,transcript,transcriptStatus,videoElement,start,disconnect,endSession,toggleMute,resumeAudio }
}
