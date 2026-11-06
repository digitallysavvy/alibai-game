/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
    // Matches nothing, so /_next/image can't be used to optimize arbitrary paths.
    localPatterns: [{ pathname: '/__none__/**' }],
  },
}

export default nextConfig
