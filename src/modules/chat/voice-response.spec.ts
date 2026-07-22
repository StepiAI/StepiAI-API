import {
  buildVoiceAgentResponse,
  buildVoiceSpeechSummary,
} from './voice-response';
import type { ScheduleProposal } from './chat.service';

describe('buildVoiceSpeechSummary', () => {
  it('summarizes schedule proposals for text-to-speech instead of returning JSON', () => {
    const proposal: ScheduleProposal = {
      type: 'schedule_proposal',
      summary: 'Belajar React',
      description: null,
      location: null,
      startDateTime: '2026-07-23T19:00:00+07:00',
      endDateTime: '2026-07-23T20:00:00+07:00',
    };

    const summary = buildVoiceSpeechSummary(proposal, 'Asia/Jakarta');

    expect(summary).toContain('Belajar React');
    expect(summary).toContain('Detailnya aku tampilkan di layar');
    expect(summary).not.toContain('"type"');
    expect(summary).not.toContain('schedule_proposal');
  });
});

describe('buildVoiceAgentResponse', () => {
  it('places confirmation data in the popup section', () => {
    const proposal: ScheduleProposal = {
      type: 'schedule_proposal',
      summary: 'Belajar React',
      description: null,
      location: null,
      startDateTime: '2026-07-23T19:00:00+07:00',
      endDateTime: '2026-07-23T20:00:00+07:00',
    };

    const response = buildVoiceAgentResponse(
      {
        parsed: proposal,
        assistantMessage: { id: 'message-1' },
        requiresConfirmation: true,
        isNeedMoreData: false,
      },
      'Asia/Jakarta',
    );

    expect(response.speech).toMatchObject({
      locale: 'id-ID',
    });
    expect(response.popup).toMatchObject({
      kind: 'proposal',
      title: 'Konfirmasi jadwal',
      data: proposal,
      actions: [
        {
          label: 'Tambah jadwal',
          method: 'POST',
          path: '/api/chats/messages/message-1/accept',
        },
      ],
    });
  });

  it('places need_info data in the popup section without accept actions', () => {
    const response = buildVoiceAgentResponse({
      parsed: {
        type: 'need_info',
        content: 'Mau tetap dibuat meski bentrok?',
      },
      assistantMessage: { id: 'message-2' },
      requiresConfirmation: false,
      isNeedMoreData: true,
    });

    expect(response.speech.summary).toBe('Mau tetap dibuat meski bentrok?');
    expect(response.popup).toMatchObject({
      kind: 'need_info',
      title: 'Butuh pilihanmu',
      data: {
        type: 'need_info',
        content: 'Mau tetap dibuat meski bentrok?',
      },
      actions: [],
    });
  });
});
