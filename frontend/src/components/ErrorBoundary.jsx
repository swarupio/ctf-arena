import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import { fallbackCopy } from './errorKind.js';
import './ErrorBoundary.css';

// Catches render errors and failed lazy chunks below it. Shows a short, stack-free message; resets when `resetKey` changes.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error: error ?? new Error('unknown') }; }

  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const copy = fallbackCopy(error);
    return <div className="error-boundary" role="alert">
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
      <div className="actions">
        <button type="button" onClick={copy.reload ? () => window.location.reload() : this.reset}>{copy.action}</button>
        <a href="/range">Back to The Range</a>
      </div>
    </div>;
  }
}

// Inside the router: a new route clears an earlier error.
export function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}
