import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface RetireConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  projectName?: string;
  credits?: number;
}

export function RetireConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  projectName,
  credits,
}: RetireConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retire project</DialogTitle>
          <DialogDescription>
            {projectName
              ? `Are you sure you want to retire ${projectName}? This action cannot be undone.`
              : 'Are you sure you want to retire this project? This action cannot be undone.'}
            {typeof credits === 'number' && (
              <span className="mt-2 block">
                {credits.toLocaleString()} credits will be retired.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Retiring…
              </>
            ) : (
              'Confirm'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
