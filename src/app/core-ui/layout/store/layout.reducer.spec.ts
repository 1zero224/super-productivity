import { INITIAL_LAYOUT_STATE, layoutReducer } from './layout.reducer';
import {
  hideAiPanel,
  hideNonTaskSidePanelContent,
  showAiPanel,
  toggleAiPanel,
  toggleShowNotes,
} from './layout.actions';

describe('layoutReducer – AI panel', () => {
  it('shows the AI panel and hides other side content', () => {
    const withNotes = layoutReducer(INITIAL_LAYOUT_STATE, toggleShowNotes());
    const state = layoutReducer(withNotes, showAiPanel());
    expect(state.isShowAiPanel).toBe(true);
    expect(state.isShowNotes).toBe(false);
  });

  it('toggles the AI panel', () => {
    const open = layoutReducer(INITIAL_LAYOUT_STATE, toggleAiPanel());
    expect(open.isShowAiPanel).toBe(true);
    expect(layoutReducer(open, toggleAiPanel()).isShowAiPanel).toBe(false);
  });

  it('is hidden by hideAiPanel and by other panels opening', () => {
    const open = layoutReducer(INITIAL_LAYOUT_STATE, showAiPanel());
    expect(layoutReducer(open, hideAiPanel()).isShowAiPanel).toBe(false);
    expect(layoutReducer(open, toggleShowNotes()).isShowAiPanel).toBe(false);
    expect(layoutReducer(open, hideNonTaskSidePanelContent()).isShowAiPanel).toBe(false);
  });
});
