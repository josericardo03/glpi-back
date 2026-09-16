export type Role = 'ADMIN' | 'MANAGER' | 'TECHNICIAN' | 'REQUESTER';
export type TicketStatus =
  | 'NEW'
  | 'TRIAGE'
  | 'OPEN'
  | 'PENDING'
  | 'APPROVAL'
  | 'RESOLVED'
  | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AssetStatus = 'IN_USE' | 'IN_STOCK' | 'MAINTENANCE' | 'RETIRED';
