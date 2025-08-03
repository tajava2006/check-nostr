import React from 'react';

interface ResultBlockProps {
  label: string;
  value: string | null | undefined;
}

const ResultBlock: React.FC<ResultBlockProps> = ({ label, value }) => {
  return (
    <div>
      <div style={{ marginBottom: 4, color: '#444' }}>{label}</div>
      <div
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          background: '#f7f7f7',
          padding: '12px',
          borderRadius: 8,
          border: '1px solid #eee',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          minHeight: '1.5em',
        }}
      >
        {value || ''}
      </div>
    </div>
  );
};

export default ResultBlock;