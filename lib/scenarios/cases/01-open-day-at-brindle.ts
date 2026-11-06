import { ask, build, disc, fact, grant, pub, span } from './helpers';

// 0. Guilty, easy. Mara says the triangular key stayed on its hook; the key board log and the merchant's counterfoil say otherwise.
export default build(0, {
  title: 'Open Day at Brindle', genre: 'cozy procedural', setting: 'Brindle civic clock workshop',
  crime: 'The brass counterweight is missing from inside the demonstration clock, which stopped at twenty to eleven on open day with the wax seal across its front still whole.',
  publicBriefing: 'Open day at the Brindle workshop is the one morning a year the trust brings its guests in, and the demonstration clock is what they come to see. It stopped at twenty to eleven, while the steward had the tour group out in the yard looking at the bell frame. Nobody was hurt. When Mara Vell reset the clock afterwards the brass counterweight, four and a half kilos of it, was gone from inside the case, and the wax seal across the display front was unbroken. Mara has kept that clock for eleven years and was the member of staff left in the room during the break. The trust meets next week on a quote to move the clock to a contractor\'s premises, and her bench rent is in arrears. A metal merchant made his usual Saturday collection from the lane before eleven and left a slip in the gate box. You have the key ledger, the slip and the steward\'s account, and the trust would like an answer before it meets.',
  suspect: { id: 'suspect', name: 'Mara Vell', ageRange: 'late forties', role: 'clock restorer', avatarDescription: 'Canvas apron over a wool jumper, cuffs rolled back off hands that have been in oil, a loupe on a cord round her neck.',
    speechStyle: 'Workshop words and few of them. Explains the clock more readily than herself.',
    attitude: 'Apologises for the state of the bench before she has sat down, and keeps glancing across at the stopped clock as if it might start.',
    relationship: 'Rents the bench from the trust; the clock came to the workshop the same year she did, and it is the reason anyone walks through the door.' },
  truth: { guilty: true, culpritId: 'suspect',
    actualEvent: 'Mara opened the rear maintenance hatch with her triangular service key while the tour was out, lifted out the counterweight, wrapped it in her padded tool roll and handed it to the metal merchant in the lane before eleven.',
    motive: 'The trust meets next week on a contractor\'s quote to move the clock out of her workshop, and the clock is the only reason her bench earns anything. The counterweight is a bespoke casting that the clock cannot run without, and under the trust\'s own rules a missing part is commissioned from the keeper at her rates. A clock that cannot run cannot be moved on the contractor\'s schedule, the refit would take months of paid work, and the fee would clear her arrears. The merchant\'s van in the lane was simply the quickest way to get the weight off the premises before anyone searched.',
    opportunity: 'She was alone with the clock from half past ten until ten to eleven while the steward had the tour in the yard.',
    means: 'The triangular service key opens the rear hatch, which sits outside the wax seal on the front display.',
    realAlibi: 'I was at my bench by the clock the whole time the tour was out, from half past ten till ten to eleven.',
    explanation: 'The seal rules out the front and nothing else; the rear hatch opens with the one triangular key, issued to Mara. The key board log has that key out at ten thirty-four and back after eleven under her initials, against her claim that it stayed on its hook. The merchant\'s seller counterfoil for the brass, with her initials on the name line, was folded in her tool roll. The trust minutes carry the quote to move the clock, her arrears, and the rule that a missing part is commissioned from the keeper, which is the money in it. The yard volunteer\'s scrap bin held iron fittings and was weighed as such. The father fetched a cap and was in the room under a minute with the steward at the door.',
    timeline: [
      span('time-1', 'suspect', '2026-03-14', '10:00', '10:28', 'clock bench', 'Mara readies the demonstration clock for the open day tour.', false),
      span('time-2', 'suspect', '2026-03-14', '10:30', '10:50', 'clock bench', 'Mara stays at the bench while the steward has the tour group out in the yard.', true),
      span('time-3', 'suspect', '2026-03-14', '10:38', '10:42', 'clock bench', 'Mara opens the rear hatch with the triangular key, lifts out the counterweight and wraps it in her tool roll.', true),
      span('time-4', 'suspect', '2026-03-14', '10:55', '11:03', 'workshop lane', 'Mara hands the roll to the metal merchant in the lane, takes the counterfoil and goes back in to return the key.', true),
      span('time-5', 'suspect', '2026-03-14', '11:30', '11:31', 'interview room', 'Mara sits down for the interview.', false),
    ],
    access: [grant('suspect', '2026-03-14', 'clock bench', '09:00', '13:00'), grant('suspect', '2026-03-14', 'workshop lane', '09:00', '13:00')] },
  knowledge: {
    facts: [
      fact('fact-1', 'The rear maintenance hatch opens with the triangular service key and leaves the front seal untouched.',
        ['The rear hatch takes the triangular key.', 'There\'s a hatch round the back that my key opens.', 'The front seal stays put when the back hatch comes off.', 'You can get at the works from the back hatch.']),
      fact('fact-2', 'I had the triangular key off the board during the tour break.',
        ['I had the key out during the break.', 'The triangular key was off its hook this morning.', 'The key was at my bench while the tour was out.', 'I took the key down before the break.']),
      fact('fact-3', 'Once the tour was back in I went out to the lane with my padded tool roll, just before eleven.',
        ['I took my tool roll out to the lane.', 'I went out to the lane before eleven.', 'My tool roll went out to the van with me.', 'I walked the tool roll out to the lane myself.']),
      fact('fact-4', 'The trust wants to move the clock to a contractor, my rent is three months behind, and a missing part has to be commissioned from me.',
        ['The trust wants the clock moved out.', 'We\'re three months behind on the rent.', 'A missing part gets commissioned from the keeper.', 'The clock is the only reason anyone comes in.']),
    ],
    knows: ['fact-1', 'fact-2', 'fact-3', 'fact-4'], doesNotKnow: ['What the steward or the merchant have told anyone.', 'What the yard volunteer put in the scrap bin.'],
    admitsImmediately: ['fact-1'], revealsWhenQuestioned: ['fact-2', 'fact-3', 'fact-4'],
    misleading: [
      { factId: 'fact-2', realFact: 'I had the triangular key off the board during the tour break.', permittedDeception: 'I may insist the triangular key stayed on its hook all morning and that I had no call to touch the hatch, until the key board log is put to me.' },
    ] },
  publicEvidence: [
    pub('exhibit-1', 'Merchant\'s slip left at the gate', 'record', 'Gate box', 'observation', 'Gate box: the metal merchant\'s lane slip, left for the trust as the lane rules require: Saturday, "brass, four and a half kilos, cash paid", weighed on the van scale, seller\'s line blank. The merchant\'s slips come in two halves; the gate half records the load, and the seller keeps the half with the name on it.', 'Brass of the right weight left by the lane that morning. The gate half does not say from whom, and the seller\'s half is somewhere with a name on it.'),
    pub('exhibit-3', 'Key ledger entry for the service key', 'record', 'Workshop key ledger', 'observation', 'Workshop key ledger: triangular service key, one of one, issued to M. Vell on her first day; kept on the key board when not in use; the board hangs in the workshop corridor, in reach of anyone passing, and the ledger\'s "copies made" column reads none.', 'Mara is the only person issued the key that opens the rear hatch, and the board it hangs on is in a public corridor.'),
    pub('exhibit-4', 'Steward on the tour break', 'testimony', 'Steward\'s statement', 'character_claim', 'Steward\'s statement: the group was in the yard from half past ten until ten to eleven; Mara was at her bench when they went out, with the clock ticking, and at it again when they came back in, with the clock stopped; at about a quarter to eleven the yard volunteer wheeled the scrap bin through the workshop to the lane, and the merchant\'s van was already parked there with its tailgate down.', 'Mara at both ends of the break and unseen in between, and the clock stopped while she was. One other person crossed the room, pushing a bin to a scrap merchant whose van was waiting.'),
  ],
  discoverableEvidence: [
    disc('record-1', 'Rear hatch screws', 'physical', 'Scene inspection', 'observation', 'Scene inspection: bright scratches round the four rear hatch screws and a pinch of clean brass dust on the floor beneath the case.', 'The hatch has been off recently. Mara admits it exists and that her key opens it.', ['fact-1']),
    disc('record-2', 'Key board log for the morning', 'record', 'Workshop key ledger', 'observation', 'Key board log, Saturday: triangular key out 10:34, back 11:02, initials M.V. in both columns.', 'Contradicts any claim that the key stayed on its hook, and brackets the stopped clock.', ['fact-2']),
    disc('record-3', 'Merchant\'s counterfoil in the tool roll', 'physical', 'Tool roll search', 'observation', 'Tool roll search: the seller\'s half of the merchant\'s Saturday brass slip, name line "M.V., restorer", folded into the padded pocket.', 'The blank gate slip has its other half, and it was in her roll with her initials on it.', ['fact-3']),
    disc('record-4', 'Trust minutes for March', 'record', 'Trust minutes', 'observation', 'Trust minutes, March: a contractor\'s quote to move the demonstration clock to its own premises after open day, tabled for the lease review on the twentieth; bench rent for M. Vell three months in arrears at £380 a month; standing rule that any part the clock needs is commissioned from the keeper at her rates before the clock travels, the last such commission, a replacement escapement in 2019, billed at £2,900.', 'The clock is about to leave her workshop, with £1,140 of arrears on the same page. A clock missing a part only she can make stays put, and the last refit paid nearly three thousand.', ['fact-4']),
  ],
  redHerrings: [
    pub('exhibit-2', 'Steward on the boy\'s father', 'red_herring', 'Steward\'s statement', 'character_claim', 'Steward\'s statement: during the break the father of a boy Mara had told off went back into the workshop for the boy\'s cap and came straight out again.', 'He was in and out in under a minute with the steward watching from the door, and the cap was on the coat hook by the entrance.'),
  ],
  suggestedQuestions: [
    ask('question-1', 'Is the front the only way into that clock?', 'evidence', 1, [], ['fact-1'], 'safe'),
    ask('question-2', 'Where was the triangular key this morning?', 'access', 2, [], ['fact-2'], 'safe'),
    ask('question-3', 'How\'s the workshop doing for money?', 'motive', 3, [], ['fact-4'], 'safe'),
    ask('question-4', 'What happens to the clock after the lease review?', 'motive', 4, [], ['fact-4'], 'safe'),
    ask('question-5', 'Who had that hatch off today?', 'follow_up', 1, ['record-1'], ['fact-2'], 'contextual'),
    ask('question-6', 'What went out to the lane in your tool roll?', 'follow_up', 2, ['fact-2'], ['fact-3'], 'contextual'),
    ask('question-7', 'Where did you go once the tour came back in?', 'alibi', 5, [], ['fact-3'], 'safe'),
  ],
  answerKey: { verdict: 'guilty',
    pivotal: [
      { evidenceId: 'exhibit-1', why: 'Brass of exactly the weight\'s mass went to the merchant that morning for cash.' },
      { evidenceId: 'record-2', why: 'The board log has her drawing the one key that opens the hatch, minutes before the clock stopped, against her own account.' },
      { evidenceId: 'record-3', why: 'The seller\'s half of the merchant\'s slip carries her initials, and it was in her roll.' },
    ],
    misleading: [{ evidenceId: 'exhibit-2', why: 'The father fetched a cap from the hook by the door in under a minute, watched by the steward.' }] },
  solvabilityPath: [
    { questionId: 'question-1', alternativePhrasings: ['How does anyone get inside the case with the seal still on?', 'How would anyone get at the works without breaking that seal?'], expectedFactIds: ['fact-1'], why: 'The seal only covers the front; the rear hatch and her key are the route.' },
    { questionId: 'question-2', alternativePhrasings: ['Was the triangular key off its hook this morning?', 'Did you have the key out during the break?'], expectedFactIds: ['fact-2'], why: 'She denies it until the board log is put to her, then admits the key was off the board.' },
    { questionId: 'question-6', alternativePhrasings: ['Where did your tool roll go after the break?', 'What went out to the lane with you?'], expectedFactIds: ['fact-3'], why: 'The roll went to the merchant, and the counterfoil in it carries her initials.' },
  ],
});
