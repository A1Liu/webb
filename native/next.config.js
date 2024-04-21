/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  distDir: "out",

  // For when things are confusing, and you just need to make sure double-effects
  // aren't fucking with mutation frequency
  // reactStrictMode: false,
};

export default nextConfig;
