import React, { useState, useEffect, useRef } from 'react';
import { Palette, Grid3x3, ZoomIn, ZoomOut, Eye, EyeOff, ArrowLeft, Check, X } from 'lucide-react';

  // 16-color palette (r/place style)
const COLORS = [
  '#FFFFFF', '#E4E4E4', '#888888', '#222222',
  '#FFA7D1', '#E50000', '#E59500', '#A06A42',
  '#E5D900', '#94E044', '#02BE01', '#00D3DD',
  '#0083C7', '#0000EA', '#CF6EE4', '#820080'
];

const CANVAS_SIZE = 100; // 100x100 pixels
  const PIXEL_COST = 0.00000001; // 1 satoshi per pixel
  const MAX_PIXELS = 1000; // Validation limit

const CanvasStep = ({
  address,
  shellsAvailable,
  onSubmitPixels,
  onLoadCanvas,
  onLoadUserPixelCount,
  loading,
  error,
  onBack
}) => {
  // États du canvas
  const [canvasPixels, setCanvasPixels] = useState([]); // Pixels validés (DB)
  const [pendingPixels, setPendingPixels] = useState([]); // Pixels en attente
  const [userPixelCount, setUserPixelCount] = useState(0);
  
  // États UI
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [showGrid, setShowGrid] = useState(true);
  const [showOnlyMyPixels, setShowOnlyMyPixels] = useState(false);
  const [zoom, setZoom] = useState(4); // Zoom initial (4 = 4px par pixel canvas)
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState(null);
  
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Charger le canvas au montage
  useEffect(() => {
    loadCanvas();
    loadPixelCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCanvas = async () => {
    const pixels = await onLoadCanvas();
    setCanvasPixels(pixels);
  };

  const loadPixelCount = async () => {
    const count = await onLoadUserPixelCount();
    setUserPixelCount(count);
  };

  // Dessiner le canvas
  useEffect(() => {
    drawCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasPixels, pendingPixels, showGrid, showOnlyMyPixels, zoom, pan]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const pixelSize = zoom;

    // Effacer le canvas
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Créer un map pour accès rapide
    const pixelMap = new Map();
    
    // Ajouter les pixels validés
    canvasPixels.forEach(p => {
      pixelMap.set(`${p.x},${p.y}`, { ...p, isPending: false });
    });

    // Ajouter/écraser avec les pixels en attente
    pendingPixels.forEach(p => {
      pixelMap.set(`${p.x},${p.y}`, { ...p, isPending: true });
    });

    // Dessiner tous les pixels
    pixelMap.forEach((pixel) => {
      const isMyPixel = pixel.bitcoin_address === address;
      
      // "My pixels only" filtering
      if (showOnlyMyPixels && !isMyPixel) {
        // Dessiner pixel transparent/gris
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#CCCCCC';
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = pixel.color;
      }

      const x = pixel.x * pixelSize + pan.x;
      const y = pixel.y * pixelSize + pan.y;
      ctx.fillRect(x, y, pixelSize, pixelSize);

      // Special border for pending pixels
      if (pixel.isPending) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#FFD700'; // Or
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, pixelSize, pixelSize);
      }
    });

    ctx.globalAlpha = 1;

    // Grille
    if (showGrid && zoom >= 8) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= CANVAS_SIZE; x++) {
        ctx.beginPath();
        ctx.moveTo(x * pixelSize + pan.x, pan.y);
        ctx.lineTo(x * pixelSize + pan.x, CANVAS_SIZE * pixelSize + pan.y);
        ctx.stroke();
      }
      for (let y = 0; y <= CANVAS_SIZE; y++) {
        ctx.beginPath();
        ctx.moveTo(pan.x, y * pixelSize + pan.y);
        ctx.lineTo(CANVAS_SIZE * pixelSize + pan.x, y * pixelSize + pan.y);
        ctx.stroke();
      }
    }
  };

  // Clic sur le canvas
  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left - pan.x) / zoom);
    const y = Math.floor((e.clientY - rect.top - pan.y) / zoom);

    if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) return;

    // Vérifier limite
    if (pendingPixels.length >= MAX_PIXELS) {
      alert(`Limit reached: ${MAX_PIXELS} pixels max per validation`);
      return;
    }

    // Ajouter ou modifier pixel en attente
    setPendingPixels(prev => {
      const filtered = prev.filter(p => !(p.x === x && p.y === y));
      return [...filtered, { x, y, color: selectedColor, bitcoin_address: address }];
    });
  };

  // Pan (déplacement)
  const handleMouseDown = (e) => {
    if (e.button === 1 || e.ctrlKey) {
      setIsPanning(true);
      setLastPanPoint({ x: e.clientX, y: e.clientY });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning && lastPanPoint) {
      const dx = e.clientX - lastPanPoint.x;
      const dy = e.clientY - lastPanPoint.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPanPoint({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setLastPanPoint(null);
  };

  // Zoom
  const handleZoomIn = () => setZoom(prev => Math.min(prev + 2, 20));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 2, 2));

  // Clear pending pixels
  const handleClearPending = () => {
    setPendingPixels([]);
  };

  // Validate pixels
  const handleValidate = async () => {
    if (pendingPixels.length === 0) return;

    const totalCost = pendingPixels.length * PIXEL_COST;

    if (shellsAvailable < totalCost) {
      alert(`Insufficient balance. Required: ${totalCost.toFixed(8)} shells`);
      return;
    }

    const result = await onSubmitPixels(pendingPixels);

    if (result.success) {
      // Afficher résultat
      if (result.conflicts > 0) {
        alert(`✅ ${result.pixelsPlaced} pixel(s) placed\n⚠️ ${result.conflicts} conflicting pixel(s) rejected`);
      }
      
      // Clear pending pixels and reload
      setPendingPixels([]);
      await loadCanvas();
      await loadPixelCount();
    }
  };

  const totalCost = pendingPixels.length * PIXEL_COST;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-purple-50 p-4">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to network</span>
            </button>
            
            <h2 className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-purple-600 text-transparent bg-clip-text">
              🎨 Collaborative Canvas
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div className="bg-gradient-to-br from-orange-100 to-orange-50 rounded-xl p-4">
              <p className="text-sm text-gray-600 mb-1">My placed pixels</p>
              <p className="text-2xl font-bold text-orange-600">{userPixelCount}</p>
            </div>
            
            <div className="bg-gradient-to-br from-purple-100 to-purple-50 rounded-xl p-4">
              <p className="text-sm text-gray-600 mb-1">Pending</p>
              <p className="text-2xl font-bold text-purple-600">{pendingPixels.length} / {MAX_PIXELS}</p>
            </div>
            
            <div className="bg-gradient-to-br from-blue-100 to-blue-50 rounded-xl p-4">
              <p className="text-sm text-gray-600 mb-1">Available balance</p>
              <p className="text-2xl font-bold text-blue-600">{shellsAvailable.toFixed(8)} shells</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Side panel */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Palette de couleurs */}
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Palette className="w-5 h-5" />
                Palette
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    className={`w-full aspect-square rounded-lg transition-all ${
                      selectedColor === color 
                        ? 'ring-4 ring-blue-500 scale-110' 
                        : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Selected color</p>
                <div className="flex items-center gap-2">
                  <div 
                    className="w-8 h-8 rounded border-2 border-gray-300"
                    style={{ backgroundColor: selectedColor }}
                  />
                  <span className="text-sm font-mono">{selectedColor}</span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="bg-white rounded-2xl shadow-xl p-6 space-y-3">
              <h3 className="font-bold text-lg mb-4">Controls</h3>
              
              <button
                onClick={() => setShowGrid(!showGrid)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
                  showGrid 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Grid3x3 className="w-4 h-4" />
                  Grid
                </span>
                {showGrid ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>

              <button
                onClick={() => setShowOnlyMyPixels(!showOnlyMyPixels)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
                  showOnlyMyPixels 
                    ? 'bg-purple-100 text-purple-700' 
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                <span>My pixels only</span>
                {showOnlyMyPixels ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>

              <div className="flex gap-2">
                <button
                  onClick={handleZoomOut}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <ZoomOut className="w-4 h-4" />
                  Zoom -
                </button>
                <button
                  onClick={handleZoomIn}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <ZoomIn className="w-4 h-4" />
                  Zoom +
                </button>
              </div>

              <p className="text-xs text-gray-500 text-center">
                Ctrl+click or middle mouse to pan
              </p>
            </div>

            {/* Validation */}
            {pendingPixels.length > 0 && (
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl shadow-xl p-6">
                <h3 className="font-bold text-lg mb-3">Validation</h3>
                <div className="space-y-2 text-sm mb-4">
                  <div className="flex justify-between">
                    <span>Pending pixels:</span>
                    <span className="font-bold">{pendingPixels.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total cost:</span>
                    <span className="font-bold">{totalCost.toFixed(8)} shells</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleClearPending}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    onClick={handleValidate}
                    disabled={loading || shellsAvailable < totalCost}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check className="w-4 h-4" />
                    {loading ? 'Validating...' : 'Validate'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Canvas */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <div 
                ref={containerRef}
                className="overflow-hidden rounded-lg border-2 border-gray-200 bg-gray-50"
                style={{ width: '100%', height: '600px' }}
              >
                <canvas
                  ref={canvasRef}
                  width={CANVAS_SIZE * zoom}
                  height={CANVAS_SIZE * zoom}
                  onClick={handleCanvasClick}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  className="cursor-crosshair"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                  {error}
                </div>
              )}

              <div className="mt-4 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
                💡 <strong>Tip:</strong> Click the canvas to place pixels. They will get a gold border and will be validated after you click "Validate".
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CanvasStep;
