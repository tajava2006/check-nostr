import React, { type InputHTMLAttributes } from 'react';

const StyledInput: React.FC<InputHTMLAttributes<HTMLInputElement> > = ({
  value,
  onChange,
  placeholder,
  ...rest
}) => {
  return (
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
  );
};

export default StyledInput;