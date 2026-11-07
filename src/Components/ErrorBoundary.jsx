import React from 'react';
import { reportError } from '../Services/errorLog';
import { getState } from '../Core/store';
import { projectJson } from '../Core/projectFile';

/**
 * Catches a render error below it so one broken panel (or the whole UI) does not blank the window. The user can retry the
 * part, and for the root boundary also save the project somewhere else from the live store before anything else happens.
 */
export default class ErrorBoundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { reportError(`render-${this.props.name || 'ui'}`, `${err && (err.stack || err.message)}\n${info?.componentStack || ''}`); }
  retry = () => this.setState({ err: null });
  rescue = async () => {
    try {
      const st = getState(); const path = await window.editorstage.saveDialog('project', `${st.projectName || 'Untitled'}-rescue.esproj`);
      if (path) { await window.editorstage.writeFile(path, projectJson(st)); this.setState({ saved: path, saveErr: null }); }
    } catch (e) { this.setState({ saveErr: String(e.message || e) }); }
  };
  render() {
    const { err, saved, saveErr } = this.state; if (!err) return this.props.children;
    const root = this.props.root;
    return (
      <div className="panel-pad error-boundary" role="alert" style={root ? { padding: 24 } : undefined}>
        <div className="err">{root ? 'EditorStage hit an error and the window could not be drawn.' : `${this.props.name || 'This panel'} failed.`}</div>
        <div className="muted" style={{ margin: '6px 0' }}>{String(err.message || err)}</div>
        <button onClick={root ? () => window.location.reload() : this.retry}>{root ? 'Reload window' : 'Reload panel'}</button>{' '}
        <button onClick={this.rescue}>Save Project As...</button>
        {saved && <div className="ok">Saved to {saved}</div>}{saveErr && <div className="err">{saveErr}</div>}
      </div>
    );
  }
}
