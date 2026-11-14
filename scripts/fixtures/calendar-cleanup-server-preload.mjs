// Test-only parent IPC invokes the real worker. No fixture HTTP endpoint or
// replacement business logic is exposed. The shared preload asserts the
// disposable directory/test process and blocks every outbound connection.
import './auth-real-server-preload.mjs';
process.on('message', async message => {
  if (message?.kind !== 'calendar-cleanup-run-due' || !Number.isSafeInteger(message.id)) return;
  try {
    const { creatorCalendarService } = await import('../../server/api.js');
    process.send({kind:'calendar-cleanup-due-result',id:message.id,result:creatorCalendarService.runDue()});
  } catch (error) {
    process.send({kind:'calendar-cleanup-due-result',id:message.id,error:error.message});
  }
});
