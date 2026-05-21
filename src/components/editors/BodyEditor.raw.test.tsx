import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { BodyEditor } from './BodyEditor';

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="body-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

describe('BodyEditor raw mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does not reformat raw text while typing', async () => {
    const onChange = vi.fn();

    render(
      <BodyEditor
        value={'{\n  "hello": "world"\n}'}
        mode="raw"
        onChange={onChange}
      />,
    );

    const editor = screen.getByLabelText('body-editor');
    fireEvent.change(editor, { target: { value: '{\n  \"hello\": \"world\"\n}\n{{token}}' } });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(onChange).toHaveBeenCalledWith('{\n  \"hello\": \"world\"\n}\n{{token}}');
    expect(editor).toHaveValue('{\n  \"hello\": \"world\"\n}\n{{token}}');
  });
});
