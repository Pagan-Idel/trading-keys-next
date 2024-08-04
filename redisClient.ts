import Redis from 'ioredis';

// Initialize the Redis client
const redisClient = new Redis({
  host: 'localhost',  // Redis server host
  port: 6379,         // Redis server port
  // Add additional options if needed
});

export default redisClient;
