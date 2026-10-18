import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from './Toast';

function Trigger() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast({ message: 'Something went wrong', type: 'error' })}>
      trigger
    </button>
  );
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>
  );
}

describe('Toast', () => {
  it('de-duplicates identical toasts', () => {
    renderWithProvider();
    const button = screen.getByText('trigger');

    act(() => {
      button.click();
      button.click();
      button.click();
    });

    const toasts = screen.getAllByText('Something went wrong');
    expect(toasts).toHaveLength(1);
  });

  it('caps the number of visible toasts', () => {
    function MultiTrigger() {
      const { showToast } = useToast();
      return (
        <button
          onClick={() => {
            showToast({ message: 'Error A', type: 'error' });
            showToast({ message: 'Error B', type: 'error' });
            showToast({ message: 'Error C', type: 'error' });
            showToast({ message: 'Error D', type: 'error' });
          }}
        >
          trigger-multi
        </button>
      );
    }

    render(
      <ToastProvider>
        <MultiTrigger />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('trigger-multi').click();
    });

    expect(screen.queryByText('Error A')).toBeNull();
    expect(screen.getByText('Error B')).toBeInTheDocument();
    expect(screen.getByText('Error C')).toBeInTheDocument();
    expect(screen.getByText('Error D')).toBeInTheDocument();
  });
});
