import React, { type InputHTMLAttributes } from 'react';

interface StyledInputProps extends InputHTMLAttributes<HTMLInputElement> {
  title?: string;
}

const StyledInput: React.FC<StyledInputProps> = ({
  title,
  value,
  onChange,
  placeholder,
  ...rest
}) => {
  return (
    <>
      {title && <div style={{ marginBottom: 8, color: '#444' }}>{title}</div>}
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      spellCheck={false}
      style={{
        width: '100%',
        padding: '12px 14px',
        fontSize: 16,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        border: '1px solid #ccc',
        borderRadius: 8,
        outline: 'none',
      }}
      {...rest}
      />
    </>
  );
};

export default StyledInput;