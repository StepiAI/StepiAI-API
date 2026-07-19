import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenAiService } from '../openai/openai.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { buildScheduleInstructions } from './schedule-instructions';

export interface ScheduleProposal {
  type: 'schedule_proposal';
  summary: string;
  description: string | null;
  location: string | null;
  startDateTime: string;
  endDateTime: string;
}

export interface AssistantMessage {
  type: 'message';
  content: string;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openAiService: OpenAiService,
  ) {}

  async getOrCreateChat(userId: string) {
    const existing = await this.prisma.chat.findUnique({
      where: { userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.chat.create({
      data: { userId },
      include: { messages: true },
    });
  }

  async sendMessage(userId: string, dto: CreateMessageDto) {
    const chat = await this.getOrCreateChat(userId);

    const userMessage = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'user',
        content: dto.content,
      },
    });

    const history = await this.prisma.message.findMany({
      where: { chatId: chat.id },
      orderBy: { createdAt: 'asc' },
    });

    const conversation = history
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');

    let parsed: ScheduleProposal | AssistantMessage;

    try {
      const raw = await this.openAiService.generateText(conversation, {
        instructions: buildScheduleInstructions(new Date(), dto.timezone),
      });

      parsed = JSON.parse(raw) as ScheduleProposal | AssistantMessage;
    } catch (error) {
      throw new InternalServerErrorException(
        'Unable to get a response from the AI assistant',
        String(error),
      );
    }

    const isScheduleProposal = parsed.type === 'schedule_proposal';

    const assistantMessage = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'assistant',
        content: JSON.stringify(parsed),
        isScheduleProposal,
      },
    });

    await this.prisma.chat.update({
      where: { id: chat.id },
      data: { updatedAt: new Date() },
    });

    return {
      chatId: chat.id,
      userMessage,
      assistantMessage,
      requiresConfirmation: isScheduleProposal,
      proposal: isScheduleProposal ? (parsed as ScheduleProposal) : undefined,
    };
  }
}
