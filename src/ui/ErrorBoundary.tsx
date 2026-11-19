import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Short name shown in the error message. */
  label: string;
  /** Optional action offered next to the message (for example closing the window). */
  onDismiss?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}] render error`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="error-boundary">
        <p>
          {this.props.label} stopped working: {error.message}
        </p>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
        {this.props.onDismiss && (
          <button type="button" onClick={this.props.onDismiss}>
            Close
          </button>
        )}
      </div>
    );
  }
}
