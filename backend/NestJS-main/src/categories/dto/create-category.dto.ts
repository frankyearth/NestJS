import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MinLength, MaxLength } from "class-validator";

export class CreateCategoryDto {
  @IsString()
  @MinLength(4)
  title!: string;

@ApiProperty({ example: 'Active', required: false }) // Shows it in Swagger
  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(70)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(170)
  seoDescription?: string;
}
