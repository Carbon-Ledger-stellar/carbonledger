import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface PauseStatus {
  is_paused: boolean;
  paused_at: string | null;
}

export const getPauseStatus = async (): Promise<PauseStatus> => {
  const response = await api.get<PauseStatus>('/api/pause/status');
  return response.data;
};

export default api;
