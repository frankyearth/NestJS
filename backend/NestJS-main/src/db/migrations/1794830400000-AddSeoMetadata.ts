import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeoMetadata1794830400000 implements MigrationInterface {
  name = 'AddSeoMetadata1794830400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "seoTitle" character varying(70)`);
    await queryRunner.query(`ALTER TABLE "products" ADD "seoDescription" character varying(170)`);
    await queryRunner.query(`ALTER TABLE "categories" ADD "seoTitle" character varying(70)`);
    await queryRunner.query(`ALTER TABLE "categories" ADD "seoDescription" character varying(170)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "seoDescription"`);
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "seoTitle"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "seoDescription"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "seoTitle"`);
  }
}
