import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenAiService } from '../openai/openai.service';
import { CreateMessageDto } from './dto/create-message.dto';

const SCHEDULE_ASSISTANT_INSTRUCTIONS = `You are StepiAI's scheduling assistant.
Reply with ONLY a single raw JSON object and nothing else (no markdown, no code fences, no commentary).

If the user is asking you to create, update, or schedule an event/appointment/reminder, respond with:
{
  "type": "schedule_proposal",
  "summary": string,
  "description": string | null,
  "location": string | null,
  "startDateTime": string in ISO 8601,
  "endDateTime": string in ISO 8601
}
You are only proposing the event. Never assume it has been created — the user must explicitly confirm it afterwards.

For any other message, respond with:
{
  "type": "message",
  "content": string
}

Always return valid, parseable JSON matching one of the two shapes above.`;

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
        instructions: SCHEDULE_ASSISTANT_INSTRUCTIONS,
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
