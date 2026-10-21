import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminControlPanel from './AdminControlPanel';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  pauseContract: vi.fn(),
  unpauseContract: vi.fn(),
}));

describe('AdminControlPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pause and unpause buttons', () => {
    render(<AdminControlPanel isAdmin />);
    expect(screen.getByRole('button', { name: /pause contract/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unpause contract/i })).toBeInTheDocument();
  });

  it('disables buttons when user is not admin', () => {
    render(<AdminControlPanel isAdmin={false} />);
    expect(screen.getByRole('button', { name: /pause contract/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /unpause contract/i })).toBeDisabled();
  });

  it('shows a confirmation dialog before pausing', async () => {
    render(<AdminControlPanel isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: /pause contract/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
  });

  it('calls pauseContract with the provided reason and shows success', async () => {
    (api.pauseContract as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    render(<AdminControlPanel isAdmin />);

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'maintenance' } });
    fireEvent.click(screen.getByRole('button', { name: /pause contract/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(api.pauseContract).toHaveBeenCalledWith('maintenance'));
    expect(await screen.findByText(/paused successfully/i)).toBeInTheDocument();
  });

  it('shows a user-friendly error message on failure', async () => {
    (api.unpauseContract as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    render(<AdminControlPanel isAdmin />);

    fireEvent.click(screen.getByRole('button', { name: /unpause contract/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));

    expect(await screen.findByText(/unable to unpause/i)).toBeInTheDocument();
  });
});
