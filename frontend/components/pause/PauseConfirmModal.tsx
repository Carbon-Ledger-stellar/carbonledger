"use client";

import React, { useState, useEffect, useRef } from 'react';
import { PauseConfirmModalProps } from './types';

export const PauseConfirmModal: React.FC<PauseConfirmModalProps> = ({
  isOpen,
  action,
  onConfirm,
  onCancel,
  isLoading = false,
  currentStatus,
}) => {
  const [durationHours, setDurationHours] = useState<number>(24);
  const [reason, setReason] = useState<string>('');
  const [confirmedCheck, setConfirmedCheck] = useState<boolean>(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Reset form when opened
  useEffect(() => {
    if (isOpen) {
      setReason('');
      setConfirmedCheck(false);
      setDurationHours(24);
      setTimeout(() => {
        cancelBtnRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Focus trap and Escape listener
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (action === 'pause' && (!reason.trim() || !confirmedCheck)) return;
    onConfirm(durationHours, reason);
  };

  const isPause = action === 'pause';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-modal-title"
        aria-describedby="pause-modal-desc"
        data-testid="pause-confirm-modal"
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden transform transition-all"
      >
        <div className={`p-6 border-b ${isPause ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/50' : 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/50'}`}>
          <div className="flex items-center space-x-3">
            <span
              className={`p-2.5 rounded-full ${
                isPause
                  ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-300'
                  : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300'
              }`}
            >
              {isPause ? (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </span>
            <div>
              <h2 id="pause-modal-title" className="text-lg font-bold text-gray-900 dark:text-white">
                {isPause ? 'Confirm Emergency Pause' : 'Confirm Resume Operations'}
              </h2>
              <p id="pause-modal-desc" className="text-xs text-gray-500 dark:text-gray-400">
                {isPause
                  ? 'Halting contract execution will suspend all on-chain settlement and trading.'
                  : 'Resuming operations will re-enable all marketplace trades and carbon retirements.'}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {isPause ? (
            <>
              <div>
                <label htmlFor="pause-duration-select" className="block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
                  Pause Duration Window
                </label>
                <select
                  id="pause-duration-select"
                  name="pauseDuration"
                  aria-describedby="pause-duration-helper"
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  <option value={1}>1 Hour (Quick Maintenance)</option>
                  <option value={6}>6 Hours (Incident Triage)</option>
                  <option value={24}>24 Hours (Standard Investigation)</option>
                  <option value={72}>72 Hours (Maximum Time-Bound Window)</option>
                </select>
                <p id="pause-duration-helper" className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  In compliance with safety policy, pause automatically expires after a maximum of 72 hours.
                </p>
              </div>

              <div>
                <label htmlFor="pause-reason-input" className="block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
                  Incident Reason & Scope <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <textarea
                  id="pause-reason-input"
                  name="pauseReason"
                  required
                  aria-required="true"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Investigating unexpected oracle variance in batch #402"
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                />
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/40 p-3 rounded-md border border-amber-300 dark:border-amber-800 text-xs text-amber-950 dark:text-amber-200">
                <span className="font-semibold block mb-0.5">Affected Services:</span>
                • Soroban CarbonCredit minting, transfer & retirement<br />
                • Carbon Marketplace order placement & fulfillment<br />
                • Automated API settlements & webhooks
              </div>

              <div className="flex items-start space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="confirm-pause-ack"
                  name="confirmPauseAck"
                  aria-required="true"
                  checked={confirmedCheck}
                  onChange={(e) => setConfirmedCheck(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-400 text-rose-600 focus:ring-rose-500 mt-0.5 focus-visible:ring-2 focus-visible:ring-offset-2"
                />
                <label htmlFor="confirm-pause-ack" className="text-xs font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                  I understand that this is an emergency operation that will immediately interrupt all active users and trigger on-chain pause events.
                </label>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">
                Are you sure you want to lift the emergency pause and resume normal operations?
              </p>
              {currentStatus?.reason && (
                <div className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                  <strong className="font-semibold">Initial pause reason:</strong> {currentStatus.reason}
                </div>
              )}
            </div>
          )}

          <div className="pt-4 flex items-center justify-end space-x-3 border-t border-gray-200 dark:border-gray-800">
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-500 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || (isPause && (!reason.trim() || !confirmedCheck))}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                isPause
                  ? 'bg-rose-700 hover:bg-rose-800 focus-visible:ring-rose-600 dark:bg-rose-600 dark:hover:bg-rose-700'
                  : 'bg-emerald-700 hover:bg-emerald-800 focus-visible:ring-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700'
              }`}
            >
              {isLoading
                ? 'Broadcasting...'
                : isPause
                ? 'Execute Pause'
                : 'Confirm & Resume'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PauseConfirmModal;
