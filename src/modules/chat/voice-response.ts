import { normalizeTimeZone } from './schedule-instructions';
import type {
  LifePlanDeleteProposal,
  LifePlanProposal,
  LifePlanUpdateProposal,
  ParsedAssistantResponse,
  ScheduleDeleteProposal,
  ScheduleProposal,
  ScheduleUpdateProposal,
} from './chat.service';

type VoicePopupKind = 'need_info' | 'proposal';

interface VoicePopupAction {
  label: string;
  method: 'POST';
  path: string;
}

export interface VoiceSpeechPayload {
  locale: 'id-ID';
  summary: string;
}

export interface VoicePopupPayload {
  kind: VoicePopupKind;
  title: string;
  message: string;
  data: ParsedAssistantResponse;
  actions: VoicePopupAction[];
}

export interface VoiceAgentSourceResult {
  parsed: ParsedAssistantResponse;
  assistantMessage: { id: string };
  requiresConfirmation: boolean;
  isNeedMoreData: boolean;
}

export function buildVoiceAgentResponse<T extends VoiceAgentSourceResult>(
  result: T,
  rawTimeZone?: string | null,
): T & { speech: VoiceSpeechPayload; popup: VoicePopupPayload | null } {
  const timeZone = normalizeTimeZone(rawTimeZone);
  const speech = {
    locale: 'id-ID' as const,
    summary: buildVoiceSpeechSummary(result.parsed, timeZone),
  };

  return {
    ...result,
    speech,
    popup: buildVoicePopup(result, speech.summary, timeZone),
  };
}

export function buildVoiceSpeechSummary(
  parsed: ParsedAssistantResponse,
  rawTimeZone?: string | null,
): string {
  const timeZone = normalizeTimeZone(rawTimeZone);

  switch (parsed.type) {
    case 'message':
    case 'need_info':
      return parsed.content;

    case 'schedule_proposal':
      return `Aku sudah siapkan jadwal ${parsed.summary} untuk ${formatDateTime(
        parsed.startDateTime,
        timeZone,
      )}. Detailnya aku tampilkan di layar.`;

    case 'schedule_update_proposal':
      return `Aku sudah siapkan perubahan jadwal ${parsed.summary} untuk ${formatDateTime(
        parsed.startDateTime,
        timeZone,
      )}. Cek detailnya di layar ya.`;

    case 'schedule_delete_proposal':
      return `Aku sudah siapkan penghapusan jadwal ${parsed.summary}. Konfirmasi dulu di layar ya.`;

    case 'life_plan_proposal':
      return `Aku sudah siapkan study plan ${parsed.title} dari ${formatDateOnly(
        parsed.startDate,
      )} sampai ${formatDateOnly(parsed.endDate)}. Detailnya aku tampilkan di layar.`;

    case 'life_plan_update_proposal':
      return `Aku sudah siapkan perubahan study plan ${parsed.title}. Cek detailnya di layar ya.`;

    case 'life_plan_delete_proposal':
      return `Aku sudah siapkan penghapusan study plan ${parsed.title}. Konfirmasi dulu di layar ya.`;

    default:
      return 'Aku sudah siapkan responsnya. Detailnya aku tampilkan di layar.';
  }
}

function buildVoicePopup(
  result: VoiceAgentSourceResult,
  message: string,
  rawTimeZone?: string | null,
): VoicePopupPayload | null {
  if (result.isNeedMoreData || result.parsed.type === 'need_info') {
    return {
      kind: 'need_info',
      title: 'Butuh pilihanmu',
      message,
      data: result.parsed,
      actions: [],
    };
  }

  if (!result.requiresConfirmation) {
    return null;
  }

  const acceptAction = getAcceptAction(
    result.parsed,
    result.assistantMessage.id,
  );
  const rejectAction = getRejectAction(
    result.parsed,
    result.assistantMessage.id,
  );
  const actions = [acceptAction, rejectAction].filter(
    (action): action is VoicePopupAction => Boolean(action),
  );

  return {
    kind: 'proposal',
    title: getProposalTitle(result.parsed),
    message: buildPopupMessage(result.parsed, rawTimeZone),
    data: result.parsed,
    actions,
  };
}

function getAcceptAction(
  parsed: ParsedAssistantResponse,
  messageId: string,
): VoicePopupAction | null {
  const basePath = `/api/chats/messages/${messageId}`;

  switch (parsed.type) {
    case 'schedule_proposal':
      return {
        label: 'Tambah jadwal',
        method: 'POST',
        path: `${basePath}/accept`,
      };
    case 'schedule_update_proposal':
      return {
        label: 'Simpan perubahan',
        method: 'POST',
        path: `${basePath}/accept-schedule-update`,
      };
    case 'schedule_delete_proposal':
      return {
        label: 'Hapus jadwal',
        method: 'POST',
        path: `${basePath}/accept-schedule-delete`,
      };
    case 'life_plan_proposal':
      return {
        label: 'Buat study plan',
        method: 'POST',
        path: `${basePath}/accept-life-plan`,
      };
    case 'life_plan_update_proposal':
      return {
        label: 'Simpan perubahan',
        method: 'POST',
        path: `${basePath}/accept-life-plan-update`,
      };
    case 'life_plan_delete_proposal':
      return {
        label: 'Hapus study plan',
        method: 'POST',
        path: `${basePath}/accept-life-plan-delete`,
      };
    default:
      return null;
  }
}

function getRejectAction(
  parsed: ParsedAssistantResponse,
  messageId: string,
): VoicePopupAction | null {
  const basePath = `/api/chats/messages/${messageId}`;

  switch (parsed.type) {
    case 'schedule_proposal':
    case 'schedule_update_proposal':
    case 'schedule_delete_proposal':
    case 'life_plan_proposal':
    case 'life_plan_update_proposal':
    case 'life_plan_delete_proposal':
      return {
        label: 'Tolak',
        method: 'POST',
        path: `${basePath}/reject`,
      };
    default:
      return null;
  }
}

function getProposalTitle(parsed: ParsedAssistantResponse) {
  switch (parsed.type) {
    case 'schedule_proposal':
      return 'Konfirmasi jadwal';
    case 'schedule_update_proposal':
      return 'Konfirmasi perubahan jadwal';
    case 'schedule_delete_proposal':
      return 'Konfirmasi hapus jadwal';
    case 'life_plan_proposal':
      return 'Konfirmasi study plan';
    case 'life_plan_update_proposal':
      return 'Konfirmasi perubahan study plan';
    case 'life_plan_delete_proposal':
      return 'Konfirmasi hapus study plan';
    default:
      return 'Konfirmasi';
  }
}

function buildPopupMessage(
  parsed: ParsedAssistantResponse,
  rawTimeZone?: string | null,
) {
  const timeZone = normalizeTimeZone(rawTimeZone);

  switch (parsed.type) {
    case 'schedule_proposal':
    case 'schedule_update_proposal':
      return formatSchedulePopup(parsed, timeZone);
    case 'schedule_delete_proposal':
      return `Jadwal: ${parsed.summary}`;
    case 'life_plan_proposal':
    case 'life_plan_update_proposal':
      return formatLifePlanPopup(parsed);
    case 'life_plan_delete_proposal':
      return `Study plan: ${parsed.title}`;
    default:
      return buildVoiceSpeechSummary(parsed, timeZone);
  }
}

function formatSchedulePopup(
  proposal: ScheduleProposal | ScheduleUpdateProposal,
  timeZone: string,
) {
  return `${proposal.summary} - ${formatDateTime(
    proposal.startDateTime,
    timeZone,
  )} sampai ${formatTime(proposal.endDateTime, timeZone)}`;
}

function formatLifePlanPopup(
  proposal: LifePlanProposal | LifePlanUpdateProposal,
) {
  return `${proposal.title} - ${formatDateOnly(
    proposal.startDate,
  )} sampai ${formatDateOnly(proposal.endDate)}`;
}

function formatDateTime(value: string, timeZone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatTime(value: string, timeZone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split('-').map(Number);

  if (!year || !month || !day) return value;

  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
