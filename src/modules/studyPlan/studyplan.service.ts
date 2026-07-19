import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStudyPlanDto } from './dto/create-studyplan.dto';

@Injectable()
export class StudyPlanService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateStudyPlanDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }

    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException('endTime must be after startTime');
    }

    return this.prisma.studyPlan.create({
      data: {
        userId,
        title: dto.title,
        goal: dto.goal,
        topics: dto.topic,
        startDate,
        endDate,
        availableDays: dto.availableDays,
        startTime: dto.startTime,
        endTime: dto.endTime,
        difficultyLevel: dto.difficultyLevel,
      },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.studyPlan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
