module.exports = {
  apps: [
    {
      name: "proxy",
      script: "./server.js",
      cwd: "/root/ai-lab/proxy",
      env: {
        PORT: "3040",
        UPSTREAM_BASE_URL: "https://example.com",
        UPSTREAM_API_KEY: "replace-with-real-key"
      }
    }
  ]
};
