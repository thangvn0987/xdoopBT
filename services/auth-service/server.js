// Placeholder entrypoint so Docker container can start.
console.log(
  "auth-service placeholder running on PORT",
  process.env.PORT || 3000
);
setInterval(() => {}, 1 << 30);
