import { useCallback, useEffect, useRef, useState } from 'react';
import { optimizePostImages, releasePostImage } from '../lib/postMedia';

/**
 * Shared lifecycle for photos attached to a post, comment or quoted repost.
 * It owns optimization, preview URLs and their cleanup so every composer uses
 * the same limits and cannot leak browser object URLs.
 */
export const useMessagePhotos = () => {
  const [photos, setPhotos] = useState([]);
  const [isOptimizingPhotos, setIsOptimizingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photosRef = useRef([]);
  const mountedRef = useRef(true);

  const replacePhotos = useCallback((nextPhotos) => {
    photosRef.current = nextPhotos;
    setPhotos(nextPhotos);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      photosRef.current.forEach((photo) => releasePostImage(photo));
      photosRef.current = [];
    };
  }, []);

  const selectPhotos = useCallback(async (files) => {
    setPhotoError('');
    setIsOptimizingPhotos(true);
    try {
      const optimized = await optimizePostImages(files, photosRef.current.length);
      if (!mountedRef.current) {
        optimized.forEach((photo) => releasePostImage(photo));
        return;
      }
      replacePhotos([...photosRef.current, ...optimized]);
    } catch (error) {
      if (mountedRef.current) {
        setPhotoError(error.message || 'The selected photos could not be optimized.');
      }
    } finally {
      if (mountedRef.current) setIsOptimizingPhotos(false);
    }
  }, [replacePhotos]);

  const removePhoto = useCallback((photoId) => {
    const removed = photosRef.current.find((photo) => photo.id === photoId);
    if (removed) releasePostImage(removed);
    replacePhotos(photosRef.current.filter((photo) => photo.id !== photoId));
  }, [replacePhotos]);

  const clearPhotos = useCallback(() => {
    photosRef.current.forEach((photo) => releasePostImage(photo));
    replacePhotos([]);
    setPhotoError('');
  }, [replacePhotos]);

  return {
    photos,
    isOptimizingPhotos,
    photoError,
    selectPhotos,
    removePhoto,
    clearPhotos,
  };
};

export default useMessagePhotos;
