import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { verifyToken, AuthError } from '../shared/auth';
import { readStatus, getPresignedAudioUrl } from '../shared/s3';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = event.requestContext.requestId ?? 'unknown';
  const jobId = event.pathParameters?.jobId;
  console.log('[status] request received', {
    requestId,
    jobId: jobId ?? null,
    hasAuthHeader: Boolean(event.headers?.authorization),
  });

  try {
    await verifyToken(event.headers?.authorization);
  } catch (e) {
    const err = e as AuthError;
    console.warn('[status] auth failed', { requestId, statusCode: err.statusCode, message: err.message });
    return json(err.statusCode ?? 401, { error: err.message });
  }

  if (!jobId) return json(400, { error: 'Missing jobId' });

  const status = await readStatus(jobId);
  if (!status) {
    console.warn('[status] job not found', { requestId, jobId });
    return json(404, { error: 'Job not found' });
  }
  console.log('[status] status read', { requestId, jobId, status: status.status });

  if (status.status === 'done') {
    const audioUrl = await getPresignedAudioUrl(jobId);
    console.log('[status] returning done with audio url', { requestId, jobId });
    return json(200, { ...status, audioUrl });
  }

  return json(200, status);
};
