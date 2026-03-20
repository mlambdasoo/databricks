/**
 * In-memory job store for async chat processing
 * Jobs track the status of background chat operations
 */

// Message part types that can be accumulated during streaming
export interface JobMessagePart {
  type: string;
  [key: string]: any;
}

export interface ChatJob {
  id: string;
  chatId: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  messageId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Partial text accumulated during streaming (for backward compatibility)
  partialText: string;
  // Full message parts (text, tool calls, tool results, reasoning, etc.)
  parts: JobMessagePart[];
  // Number of updates received
  partsReceived: number;
  // Finish reason when completed
  finishReason: string | null;
}

// In-memory store - jobs are cleaned up after 1 hour
const jobs = new Map<string, ChatJob>();
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Create a new job
 */
export function createJob(jobId: string, chatId: string): ChatJob {
  const job: ChatJob = {
    id: jobId,
    chatId,
    status: 'pending',
    messageId: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    partialText: '',
    parts: [],
    partsReceived: 0,
    finishReason: null,
  };

  jobs.set(jobId, job);
  console.log(`[JobStore] Created job ${jobId} for chat ${chatId}`);

  // Schedule cleanup
  setTimeout(() => {
    if (jobs.has(jobId)) {
      jobs.delete(jobId);
      console.log(`[JobStore] Cleaned up expired job ${jobId}`);
    }
  }, JOB_TTL_MS);

  return job;
}

/**
 * Get a job by ID
 */
export function getJob(jobId: string): ChatJob | undefined {
  return jobs.get(jobId);
}

/**
 * Update job status
 */
export function updateJobStatus(
  jobId: string,
  status: ChatJob['status'],
  updates?: Partial<ChatJob>
): ChatJob | undefined {
  const job = jobs.get(jobId);
  if (!job) {
    console.warn(`[JobStore] Job ${jobId} not found for update`);
    return undefined;
  }

  job.status = status;
  job.updatedAt = new Date();

  if (updates) {
    Object.assign(job, updates);
  }

  jobs.set(jobId, job);
  return job;
}

/**
 * Append text to job's partial result
 * Updates the LAST text part if it exists, otherwise creates a new one.
 * This preserves text-tool-text ordering when tool calls split text.
 */
export function appendJobText(jobId: string, text: string): void {
  const job = jobs.get(jobId);
  if (job) {
    job.partialText += text;
    job.partsReceived++;
    job.updatedAt = new Date();

    // Find the LAST part - if it's a text part, append to it
    const lastPart = job.parts.length > 0 ? job.parts[job.parts.length - 1] : null;
    if (lastPart && lastPart.type === 'text') {
      lastPart.text += text;
    } else {
      // Last part is not text (or no parts yet), create new text part
      job.parts.push({ type: 'text', text: text });
    }
  }
}

/**
 * Add a message part to the job (tool call, tool result, reasoning, etc.)
 */
export function addJobPart(jobId: string, part: JobMessagePart): void {
  const job = jobs.get(jobId);
  if (job) {
    job.parts.push(part);
    job.partsReceived++;
    job.updatedAt = new Date();
  }
}

/**
 * Update an existing part by matching criteria (e.g., toolCallId)
 */
export function updateJobPart(
  jobId: string,
  matcher: (part: JobMessagePart) => boolean,
  updates: Partial<JobMessagePart>
): void {
  const job = jobs.get(jobId);
  if (job) {
    const part = job.parts.find(matcher);
    if (part) {
      Object.assign(part, updates);
      job.partsReceived++;
      job.updatedAt = new Date();
    }
  }
}

/**
 * Set the final parts array (used when stream completes)
 */
export function setJobParts(jobId: string, parts: JobMessagePart[]): void {
  const job = jobs.get(jobId);
  if (job) {
    job.parts = parts;
    job.partsReceived++;
    job.updatedAt = new Date();
  }
}

/**
 * Mark job as completed
 */
export function completeJob(
  jobId: string,
  messageId: string,
  finishReason: string | null
): void {
  const job = jobs.get(jobId);
  if (job) {
    job.status = 'completed';
    job.messageId = messageId;
    job.finishReason = finishReason;
    job.updatedAt = new Date();
    console.log(`[JobStore] Job ${jobId} completed with message ${messageId}`);
  }
}

/**
 * Mark job as failed
 */
export function failJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (job) {
    job.status = 'error';
    job.error = error;
    job.updatedAt = new Date();
    console.log(`[JobStore] Job ${jobId} failed: ${error}`);
  }
}

/**
 * Get all active jobs (for debugging)
 */
export function getActiveJobs(): ChatJob[] {
  return Array.from(jobs.values()).filter(
    (job) => job.status === 'pending' || job.status === 'streaming'
  );
}
