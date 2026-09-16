import type {
  AssetStatus,
  Role,
  TicketPriority,
  TicketStatus,
} from './types.js';

export const now = () => new Date().toISOString();

export const users = [
  {
    id: 'u-1',
    name: 'Ana Gestora',
    email: 'ana.gestora@empresa.com',
    role: 'MANAGER' as Role,
    departmentId: 'd-1',
    avatarUrl: null,
  },
  {
    id: 'u-2',
    name: 'Carlos Técnico',
    email: 'carlos.tecnico@empresa.com',
    role: 'TECHNICIAN' as Role,
    departmentId: 'd-2',
    avatarUrl: null,
  },
  {
    id: 'u-3',
    name: 'Maria Solicitante',
    email: 'maria@empresa.com',
    role: 'REQUESTER' as Role,
    departmentId: 'd-1',
    avatarUrl: null,
  },
];

export const departments = [
  { id: 'd-1', name: 'Administrativo', code: 'ADM' },
  { id: 'd-2', name: 'TI', code: 'TI' },
];

export const groups = [
  {
    id: 'g-1',
    name: 'N1 – Atendimento',
    description: 'Triagem e suporte inicial',
    memberIds: ['u-2'],
  },
];

export const categories = [
  { id: 'c-1', name: 'Hardware', parentId: null },
  { id: 'c-2', name: 'Software', parentId: null },
  { id: 'c-3', name: 'Notebook', parentId: 'c-1' },
];

export const slaRules = [
  {
    id: 'sla-1',
    name: 'Crítico – 4h',
    priority: 'CRITICAL' as TicketPriority,
    responseMins: 15,
    resolveMins: 240,
    categoryId: 'c-1',
  },
  {
    id: 'sla-2',
    name: 'Médio – 24h',
    priority: 'MEDIUM' as TicketPriority,
    responseMins: 60,
    resolveMins: 1440,
    categoryId: null,
  },
];

export const tickets = [
  {
    id: 't-10',
    number: 10,
    title: 'Notebook não liga',
    description: 'Equipamento da diretoria sem energia após atualização.',
    status: 'TRIAGE' as TicketStatus,
    priority: 'HIGH' as TicketPriority,
    requesterId: 'u-3',
    assigneeId: 'u-2' as string | null,
    departmentId: 'd-1' as string | null,
    categoryId: 'c-3' as string | null,
    slaRuleId: 'sla-1' as string | null,
    assetId: 'a-1' as string | null,
    createdAt: now(),
    updatedAt: now(),
  },
];

export const followups = [
  {
    id: 'f-1',
    ticketId: 't-10',
    authorId: 'u-2',
    content: 'Ticket recebido na fila de triagem.',
    createdAt: now(),
  },
];

export const approvals = [
  {
    id: 'ap-1',
    ticketId: 't-10',
    approverId: 'u-1',
    status: 'PENDING',
    comment: null,
    createdAt: now(),
  },
];

export const articles = [
  {
    id: 'kb-1',
    title: 'Como resetar senha corporativa',
    content: 'Passo a passo da solução padrão de reset de senha.',
    published: true,
    authorId: 'u-2',
    createdAt: now(),
  },
];

export const assets = [
  {
    id: 'a-1',
    name: 'Notebook Dell Latitude 5540',
    inventoryTag: 'NB-00421',
    type: 'Notebook',
    status: 'IN_USE' as AssetStatus,
    location: 'Sede – 3º andar',
  },
];

export const notifications = [
  {
    id: 'n-1',
    userId: 'u-2',
    title: 'Novo ticket na triagem',
    body: 'Ticket #10 aguardando classificação.',
    read: false,
    createdAt: now(),
  },
];

export const auditLogs = [
  {
    id: 'log-1',
    action: 'TICKET_CREATED',
    entity: 'Ticket',
    entityId: 't-10',
    userId: 'u-3',
    metadata: { number: 10 },
    createdAt: now(),
  },
];

export const branding = {
  id: 'b-1',
  companyName: 'Portal ITSM',
  primaryColor: '#1B2430',
  logoUrl: null,
};

export const integrations = [
  {
    id: 'i-1',
    name: 'E-mail SMTP',
    type: 'email',
    enabled: true,
    config: { host: 'smtp.empresa.com' },
  },
  {
    id: 'i-2',
    name: 'LDAP / AD',
    type: 'ldap',
    enabled: false,
    config: {},
  },
];
