module.exports = {
  apps: [
    {
      name: "aimate",
      cwd: __dirname,
      script: "src/platforms/discord/index.js",
      autorestart: true,
      stop_exit_codes: [78],
      restart_delay: 5000,
      min_uptime: 30000,
      max_restarts: 5,
    },
  ],
};
