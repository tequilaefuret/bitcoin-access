import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  FeedSkeleton,
  ListSkeleton,
  OpinionFeedSkeleton,
  ProfileSkeleton,
  ScreenSkeleton,
} from './ContentSkeletons';

describe('ContentSkeletons', () => {
  it('announces feed placeholders to assistive technology', () => {
    render(<FeedSkeleton count={2} />);

    expect(screen.getAllByRole('status', { name: 'Loading post' })).toHaveLength(2);
  });

  it.each([
    ['Opinion topics', <OpinionFeedSkeleton />],
    ['profile', <ProfileSkeleton />],
    ['session', <ScreenSkeleton label="Loading session" />],
    ['content controls', <ListSkeleton label="Loading content controls" />],
  ])('renders an accessible %s skeleton', (_name, component) => {
    render(component);

    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
});
