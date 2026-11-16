import { TypeOrmModuleOptions } from "@nestjs/typeorm";

// Database credentials must be supplied through environment variables.
// Do not commit production credentials or silently fall back to a known password.
export const typeOrmCOnfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'API',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false,
};
