import { useIsMobile } from '@/hooks/useMediaQuery';

interface Column<T> {
  key: keyof T;
  header: string;
  render?: (value: any, item: T) => React.ReactNode;
}

interface ResponsiveTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T) => string | number;
  mobileCardTitle?: (item: T) => string;
}

export function ResponsiveTable<T>({
  data,
  columns,
  keyExtractor,
  mobileCardTitle,
}: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="mobile-card-container">
        {data.map((item) => (
          <div key={keyExtractor(item)} className="mobile-card">
            {mobileCardTitle && (
              <div className="mobile-card-title">{mobileCardTitle(item)}</div>
            )}
            {columns.map((column) => (
              <div key={String(column.key)} className="mobile-card-row">
                <span className="mobile-card-label">{column.header}</span>
                <span className="mobile-card-value">
                  {column.render
                    ? column.render(item[column.key], item)
                    : String(item[column.key])}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={String(column.key)}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={keyExtractor(item)}>
              {columns.map((column) => (
                <td key={String(column.key)}>
                  {column.render
                    ? column.render(item[column.key], item)
                    : String(item[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
