import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormError } from '../components/ui/form-error';

describe('FormError', () => {
  it('renders nothing when there is no message', () => {
    const { container } = render(<FormError message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces the message through an alert live region', () => {
    render(<FormError message="Storage quota reached" />);

    // role="alert" is what makes a failure audible. The client had none of
    // these anywhere before, so every error was visible and silent.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Storage quota reached');
  });

  it('keeps the alert role when a caller supplies its own styling', () => {
    render(<FormError message="Could not load video" className="text-white-muted text-sm" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('text-white-muted');
    expect(alert).toHaveTextContent('Could not load video');
  });

  it('surfaces the server message verbatim, which is where the caps speak', () => {
    const serverMessage =
      'This video is 900s long. The longest we can reframe is 600s — please trim it and try again.';
    render(<FormError message={serverMessage} />);

    expect(screen.getByRole('alert')).toHaveTextContent(serverMessage);
  });
});
