import { render, screen, waitFor } from '@testing-library/react';
import { VideoList } from '../components/VideoList';
import type { Video } from '../api';

const mockGetUserVideos = vi.fn();

vi.mock('../contexts/ApiContext', () => ({
  useApi: () => ({ api: { getUserVideos: mockGetUserVideos } }),
}));

const video: Video = {
  id: 'vid-1',
  user_id: 'user-1',
  original_url: 'https://example.com/storage/my-clip.mp4',
  status: 'completed',
  platform_outputs: null,
  title: 'My Great Clip',
  created_at: '2026-07-20T00:00:00.000Z',
  updated_at: '2026-07-20T00:00:00.000Z',
};

describe('VideoList card title', () => {
  beforeEach(() => {
    mockGetUserVideos.mockReset();
    mockGetUserVideos.mockResolvedValue([video]);
  });

  it('navigates to the editor when the title text is clicked', async () => {
    const onVideoSelect = vi.fn();
    render(
      <VideoList
        onVideoSelect={onVideoSelect}
        onProcessVideo={vi.fn()}
        onDeleteVideo={vi.fn()}
      />,
    );

    // The title text itself must be the clickable target, not just the
    // thumbnail hit zone or the Edit button.
    const titleText = await screen.findByText('My Great Clip');
    const titleButton = titleText.closest('button');
    expect(titleButton).not.toBeNull();

    titleButton!.click();

    await waitFor(() => expect(onVideoSelect).toHaveBeenCalledWith(video));
  });
});
