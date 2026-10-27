export { DisputesCoreModule, DisputesModule, DisputesWorkerModule } from './disputes.module';
/** Порт и события для `notifications` (ADR-0017): стороны спора и события `disputes.*`. */
export { DISPUTE_NOTICES, type DisputeNotices, type DisputeParties } from './dispute-notices.port';
export {
  DISPUTES_DISPUTE_DECIDED,
  DISPUTES_DISPUTE_FILED,
  DISPUTES_DISPUTE_RESPONDED,
  DISPUTES_DISPUTE_WITHDRAWN,
  DisputeDecidedPayload,
  DisputeEventPayload,
} from './disputes.events';
