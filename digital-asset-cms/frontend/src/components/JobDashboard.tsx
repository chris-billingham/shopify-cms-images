import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Job, JobProgressPayload, WebSocketMessage } from '../types';
import { apiClient } from '../api/client';
import { useWebSocket } from '../hooks/useWebSocket';

export function JobDashboard() {
  // Live progress overrides keyed by jobId
  const [liveUpdates, setLiveUpdates] = useState<Record<string, Partial<Job>>>({});

  const { data: fetchedJobs } = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => {
      const { data } = await apiClient.get<Job[]>('/jobs');
      return data;
    },
  });

  useWebSocket((msg: WebSocketMessage) => {
    if (msg.type === 'job_progress') {
      const { jobId, jobName, progress, status } = msg.payload as JobProgressPayload;
      setLiveUpdates((prev) => ({
        ...prev,
        [jobId]: { id: jobId, name: jobName, progress, status },
      }));
    }
  });

  // Merge fetched list with live WS updates
  const baseJobs: Job[] = fetchedJobs ?? [];
  const jobs: Job[] = [
    ...baseJobs.map((j) => ({ ...j, ...liveUpdates[j.id] } as Job)),
    // Jobs that arrived via WS but not yet in the fetched list
    ...Object.values(liveUpdates)
      .filter((u) => !baseJobs.find((j) => j.id === u.id))
      .map(
        (u) =>
          ({
            id: u.id ?? '',
            name: u.name ?? '',
            status: u.status ?? 'active',
            progress: u.progress ?? 0,
            created_at: new Date().toISOString(),
          }) as Job,
      ),
  ];

  return (
    <div>
      <h3 className="font-semibold text-sm mb-3">Background Jobs</h3>
      {jobs.length === 0 && (
        <p className="text-sm text-gray-400">No jobs running.</p>
      )}
      <ul className="space-y-2">
        {jobs.map((job) => (
          <li key={job.id} role="listitem">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-medium">{job.name}</span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  job.status === 'completed'
                    ? 'bg-green-100 text-green-700'
                    : job.status === 'failed'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-blue-100 text-blue-700'
                }`}
              >
                {job.status}
              </span>
            </div>
            <progress
              value={job.progress}
              max={100}
              aria-label={`${job.name} progress`}
              data-testid={`job-progress-${job.id}`}
              className="w-full h-1.5"
            />
            {job.error && (
              <p className="text-xs text-red-500 mt-0.5">{job.error}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
