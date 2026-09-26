import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";

/**
 * Global module — import once in AppModule and RedisService is available
 * everywhere without re-importing in individual feature modules.
 */
@Global()
@Module({
  providers: [RedisService],
  exports:   [RedisService],
})
export class RedisModule {}
