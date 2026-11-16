import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as cloudinary from "cloudinary";

import { ProductEntity } from "../entities/product.entity";
import { CreateProductDto } from "../dto/create-product.dto";

import { CategoriesEntity } from "../../categories/entities/category.entity";
import { CategoriesService } from "../../categories/services/categories.service";
import { OrderStatus } from "../../utils/common/order.enum";
import { normalizeError } from "../../utils/errors/normalize-error.util";
import { UpdateProductDto } from "../dto/update-product.dto";
import { UserEntity } from "@/users/entities/user.entity";
import { PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { extname } from "path";

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  private readonly s3Client: S3Client;
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    private readonly categoriesService: CategoriesService,
  ) {
    //-------arvan(cloudinary)---------------------------------------------------
    // This makes sure NestJS doesn't try to inject it as a provider!
    this.s3Client = new S3Client({
      region: "us-east-1",
      endpoint: process.env.ARVAN_ENDPOINT,
      credentials: {
        accessKeyId: process.env.ARVAN_ACCESS_KEY || "",
        secretAccessKey: process.env.ARVAN_SECRET_KEY || "",
      },
      forcePathStyle: true,
    });
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createProduct(
    dto: CreateProductDto,
    productImage: Express.Multer.File,
    galleryImages: Express.Multer.File[],
    currentUser: UserEntity,
  ): Promise<ProductEntity> {
    try {
      const category = await this.categoriesService.findCategoryById(+dto.categoryId);
      const { secure_url, public_id } = await this.uploadProductImage(productImage);
      let galleryUploads: { secure_url: string; public_id: string; }[] = [];
      if (galleryImages && galleryImages.length > 0) {
        galleryUploads = await Promise.all(
          galleryImages.map((file) => this.uploadProductImage(file)),
        );
      }
      const product = this.productRepository.create({
        title: dto.title,
        description: dto.description,
        seoTitle: dto.seoTitle ?? null,
        seoDescription: dto.seoDescription ?? null,
        price: dto.price,
        stock: dto.stock,
        category,
        createdBy: currentUser,
        productImage: secure_url,
        imagePublicId: public_id,
        gallery: galleryUploads, 
        discount: dto.discount ?? 0,
        discountStartDate: dto.discountStartDate || null,
        discountEndDate: dto.discountEndDate || null,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
        brand: dto.brand,
        badge: dto.badge,
        attributes: dto.attributes,
      });

      const savedProduct = await this.productRepository.save(product);
      await this.triggerFrontendRevalidation(savedProduct.id);
      return savedProduct;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error; // re-throw known HTTP exceptions as-is
      }
      const err = normalizeError(error);
      this.logger.error(err.message, err.stack);
      throw new InternalServerErrorException("Failed to create product");
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  // Public reads: inactive products must be indistinguishable from missing products.
  async findOne(id: number): Promise<ProductEntity> {
    const product = await this.productRepository.findOne({
      where: { id, isActive: true },
      relations: { category: true },
      select: {
        id: true, title: true, description: true, seoTitle: true, seoDescription: true,
        price: true, stock: true, discount: true, discountStartDate: true, discountEndDate: true,
        isActive: true, brand: true, badge: true, attributes: true, productImage: true,
        gallery: true, categoryId: true, createdAt: true, updatedAt: true,
        category: {
          id: true, title: true, description: true, seoTitle: true,
          seoDescription: true, imageUrl: true, createdAt: true, updatedAt: true,
        },
      },

    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  // Admin operations must still be able to edit, reactivate, or delete inactive products.
  private async findOneForAdmin(id: number): Promise<ProductEntity> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async findAll(page = 1, limit = 10): Promise<ProductEntity[]> {
    const safePage = Math.max(1, Math.floor(page));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const skip = (safePage - 1) * safeLimit;
    return this.productRepository.find({
      where: { isActive: true },
      relations: { category: true },
      select: {
        id: true, title: true, description: true, seoTitle: true, seoDescription: true,
        price: true, stock: true, discount: true, discountStartDate: true, discountEndDate: true,
        isActive: true, brand: true, badge: true, attributes: true, productImage: true,
        gallery: true, categoryId: true, createdAt: true, updatedAt: true,
        category: {
          id: true, title: true, description: true, seoTitle: true,
          seoDescription: true, imageUrl: true, createdAt: true, updatedAt: true,
        },
      },
      order: { updatedAt: 'DESC', id: 'DESC' },
      skip,
      take: safeLimit,
    });
  }

  async findAllForAdmin(page = 1, limit = 10): Promise<ProductEntity[]> {
    const safePage = Math.max(1, Math.floor(page));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    return this.productRepository.find({
      relations: { category: true },
      order: { updatedAt: 'DESC', id: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
  }

  async findAllForSitemap(): Promise<Array<Pick<ProductEntity, 'id' | 'updatedAt' | 'title' | 'seoTitle' | 'seoDescription'>>> {
    return this.productRepository.find({
      where: { isActive: true },
      select: { id: true, updatedAt: true, title: true, seoTitle: true, seoDescription: true },
      order: { id: 'ASC' },
    });
  }

  async findByCategoryId(categoryId: number): Promise<ProductEntity[]> {
    return this.productRepository.find({ where: { categoryId } });
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(id: number, dto: UpdateProductDto): Promise<ProductEntity> {
    const product = await this.findOneForAdmin(id);

    // ── Scalar fields: use actual ProductEntity property names ──
    // ERROR WAS HERE: 'name' does not exist — the field is 'title'
    if (dto.title !== undefined) product.title = dto.title;
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.stock !== undefined) product.stock = dto.stock;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.seoTitle !== undefined) product.seoTitle = dto.seoTitle || null;
    if (dto.seoDescription !== undefined) product.seoDescription = dto.seoDescription || null;
    if (dto.discount !== undefined) product.discount = dto.discount;
    if (dto.discountStartDate !== undefined) product.discountStartDate = dto.discountStartDate;
    if (dto.discountEndDate !== undefined) product.discountEndDate = dto.discountEndDate;
    if (dto.isActive !== undefined) product.isActive = dto.isActive;
    if (dto.brand !== undefined) product.brand = dto.brand;
    if (dto.badge !== undefined) product.badge = dto.badge;
    if (dto.attributes !== undefined) product.attributes = dto.attributes;

    // ── Category: delegate to categoriesService — no categoryRepository needed ──
    // ERROR WAS HERE: this.categoryRepository does not exist on ProductsService
    if (dto.categoryId !== undefined) {
      const category = await this.categoriesService.findCategoryById(dto.categoryId);
      product.category = category;
      product.categoryId = category.id;
    }

    const savedProduct = await this.productRepository.save(product);
    await this.triggerFrontendRevalidation(savedProduct.id);
    return savedProduct;
  }

  async updateStock(id: number, stockChange: number, status: string): Promise<ProductEntity> {
    try {
      const product = await this.findOneForAdmin(id);

      const adjustment = status === OrderStatus.DELIVERED ? -stockChange : stockChange;

      if (product.stock + adjustment < 0) {
        throw new BadRequestException("Insufficient stock available");
      }

      product.stock += adjustment;
      const savedProduct = await this.productRepository.save(product);
      await this.triggerFrontendRevalidation(savedProduct.id);
      return savedProduct;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      const err = normalizeError(error);
      this.logger.error(err.message, err.stack);
      throw new InternalServerErrorException("Failed to update stock");
    }
  }

  async updateProductsByCategoryId(categoryId: number, category: CategoriesEntity): Promise<void> {
    const products = await this.findByCategoryId(categoryId);
    if (products.length === 0) return; // nothing to update — not an error

    products.forEach((p) => {
      p.category = category;
    });
    await this.productRepository.save(products);
  }

  async removeCategoryFromProductsByCategoryId(categoryId: number): Promise<void> {
    const products = await this.productRepository.find({ where: { categoryId } });
    if (products.length === 0) return;

    products.forEach((p) => {
      p.categoryId = null;
    });
    await this.productRepository.save(products);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  // async delete(id: number): Promise<{ message: string }> {
  //   const product = await this.findOne(id);

  //   if (product.imagePublicId) {
  //     await cloudinary.v2.uploader.destroy(product.imagePublicId);
  //   }

  //   await this.productRepository.remove(product);
  //   return { message: `Product ${id} deleted successfully` };
  // }

  // async saveProduct(product: ProductEntity): Promise<ProductEntity> {
  //   return this.productRepository.save(product);
  // }
  async delete(id: number): Promise<{ message: string }> {
    const product = await this.findOneForAdmin(id);

    // 3. 👇 Swapped Cloudinary delete with S3/ArvanCloud delete
    if (product.imagePublicId) {
      try {
        const bucketName = process.env.ARVAN_BUCKET_NAME;
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: bucketName,
            Key: product.imagePublicId, // In our upload, we saved the file key as public_id
          }),
        );
      } catch (err) {
        // Log the error but don't prevent database record deletion if file was already missing
        this.logger.error(`Failed to delete image from ArvanCloud: ${product.imagePublicId}`, err);
      }
    }

    await this.productRepository.remove(product);
    await this.triggerFrontendRevalidation(id);
    return { message: `Product ${id} deleted successfully` };
  }

  private async triggerFrontendRevalidation(productId: number): Promise<void> {
    const endpoint = process.env.FRONTEND_REVALIDATE_URL;
    const secret = process.env.FRONTEND_REVALIDATE_SECRET;
    if (!endpoint || !secret) return;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-revalidate-secret': secret,
        },
        body: JSON.stringify({ productId }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.logger.warn(`Frontend revalidation returned HTTP ${response.status}`);
      }
    } catch (error) {
      const err = normalizeError(error);
      this.logger.warn(`Frontend revalidation failed: ${err.message}`);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  // private async uploadProductImage(
  //   imageFile: Express.Multer.File,
  // ): Promise<{ secure_url: string; public_id: string }> {
  //   try {
  //     return await cloudinary.v2.uploader.upload(imageFile.path, {
  //       folder: "product_images",
  //     });
  //   } catch (error) {
  //     const err = normalizeError(error);
  //     this.logger.error(`Cloudinary upload failed: ${err.message}`, err.stack);
  //     throw new InternalServerErrorException("Image upload failed");
  //   }
  // }
  //-----cloudinary-------------------------------------------------------------
  async uploadProductImage(
    file: Express.Multer.File,
  ): Promise<{ secure_url: string; public_id: string }> {
    const bucketName = process.env.ARVAN_BUCKET_NAME;
    if (!bucketName) {
      throw new InternalServerErrorException("ArvanCloud bucket name is not configured in .env");
    }

    // Generate a secure, unique filename to prevent overwrites
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = extname(file.originalname);
    const key = `products/${uniqueSuffix}${ext}`; // This acts as our "public_id"

    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file.buffer, // We read the file stream directly from memory
        ContentType: file.mimetype, // Ensures the browser displays it instead of downloading it
        ACL: "public-read", // Makes the file publicly viewable
      });

      // Send the file to ArvanCloud
      await this.s3Client.send(command);

      // Construct the public access URL
      // Format: https://[bucket-name].s3.ir-thr-at1.arvanstorage.ir/[key]
      const endpointDomain = process.env.ARVAN_ENDPOINT?.replace(/^https?:\/\//, "");
      const secure_url = `https://${bucketName}.${endpointDomain}/${key}`;

      return {
        secure_url, // Saved in your 'productImage' column
        public_id: key, // Saved in your 'imagePublicId' column (useful if you ever want to delete it!)
      };
    } catch (error) {
      this.logger.error("ArvanCloud Upload Error details:", error);
      throw new InternalServerErrorException("Image upload to ArvanCloud failed");
    }
  }
}
