import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import VirtualizedList from '../VirtualizedList';

interface Row { id: string; label: string; }

function makeItems(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, label: `Item ${i}` }));
}

describe('VirtualizedList', () => {
  it('renders all rows directly when item count is at/below the virtualize threshold', () => {
    const items = makeItems(10);
    render(
      <VirtualizedList
        items={items}
        itemHeight={50}
        height={300}
        virtualizeThreshold={20}
        getKey={(i) => i.id}
        renderItem={(i) => <span>{i.label}</span>}
      />
    );

    items.forEach((item) => expect(screen.getByText(item.label)).toBeInTheDocument());
    expect(screen.queryByTestId('virtualized-list-viewport')).not.toBeInTheDocument();
  });

  it('windows rows past the threshold — only a subset is mounted initially', () => {
    const items = makeItems(100);
    render(
      <VirtualizedList
        items={items}
        itemHeight={50}
        height={300}
        virtualizeThreshold={20}
        getKey={(i) => i.id}
        renderItem={(i) => <span>{i.label}</span>}
      />
    );

    // Viewport is 300px / 50px rows = 6 visible rows + overscan on each side.
    expect(screen.getByText('Item 0')).toBeInTheDocument();
    expect(screen.queryByText('Item 99')).not.toBeInTheDocument();

    const rendered = items.filter((i) => screen.queryByText(i.label));
    expect(rendered.length).toBeLessThan(100);
    expect(rendered.length).toBeGreaterThan(0);
  });

  it('mounts later rows after scrolling — no permanently-missing rows', () => {
    const items = makeItems(100);
    render(
      <VirtualizedList
        items={items}
        itemHeight={50}
        height={300}
        virtualizeThreshold={20}
        getKey={(i) => i.id}
        renderItem={(i) => <span>{i.label}</span>}
      />
    );

    const viewport = screen.getByTestId('virtualized-list-viewport');
    Object.defineProperty(viewport, 'scrollTop', { value: 50 * 90, writable: true });
    fireEvent.scroll(viewport);

    expect(screen.getByText('Item 99')).toBeInTheDocument();
  });

  it('total scrollable height reflects the full item count, not just what is mounted', () => {
    const items = makeItems(100);
    render(
      <VirtualizedList
        items={items}
        itemHeight={50}
        height={300}
        virtualizeThreshold={20}
        getKey={(i) => i.id}
        renderItem={(i) => <span>{i.label}</span>}
      />
    );

    const viewport = screen.getByTestId('virtualized-list-viewport');
    const spacer = viewport.firstElementChild as HTMLElement;
    expect(spacer.style.height).toBe('5000px'); // 100 * 50
  });
});
