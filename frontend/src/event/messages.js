// Messages for the two refusals a scheduled event adds to every scoring submit route (423, see docs/EVENT_MODE.md).
// Existing error helpers call eventMessage() first, so every submit form shows the same clear sentence.
export const EVENT_MESSAGES = {
  EVENT_NOT_STARTED: 'The event has not started yet. Submissions open when it begins.',
  EVENT_ENDED: 'The event has ended. Submissions are closed.',
};

// The sentence for an event refusal, or null for any other error.
export const eventMessage = (error) => (error?.code && Object.hasOwn(EVENT_MESSAGES, error.code) ? EVENT_MESSAGES[error.code] : null);
