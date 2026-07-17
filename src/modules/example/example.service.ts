import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExampleDto } from './dto/create-example.dto';

@Injectable()
export class ExampleService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForUser(userId: string) {
    return this.prisma.example.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(userId: string, dto: CreateExampleDto) {
    return this.prisma.example.create({
      data: { userId, title: dto.title },
    });
  }

  remove(userId: string, id: string) {
    return this.prisma.example.delete({ where: { id, userId } });
  }
}
