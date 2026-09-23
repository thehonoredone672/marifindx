@echo off
REM MariFindX - quick training (laptop friendly, CPU or GPU)
REM Uses the subset limits in config.yaml -> data.quick_limits

setlocal
cd /d "%~dp0\.."

echo ============================================================
echo  MariFindX - QUICK TRAINING
echo ============================================================
echo.

if not exist "data\raw\oil" (
    echo No dataset found at data\raw\oil
    echo.
    echo Either prepare the Zenodo data:
    echo     python scripts\download_dataset.py --manual
    echo.
    echo Or generate synthetic scenes to validate the pipeline:
    echo     python scripts\make_demo_data.py
    echo.
    exit /b 1
)

echo [1/3] Training...
python -m ml.train --config config.yaml --mode quick
if errorlevel 1 goto :failed

echo.
echo [2/3] Evaluating on the held-out test split...
python -m ml.test --config config.yaml
if errorlevel 1 goto :failed

echo.
echo [3/3] Running inference on the demo scene...
if exist "data\demo\demo_scene.tif" (
    python -m ml.inference --image data\demo\demo_scene.tif
)

echo.
echo ============================================================
echo  Done.
echo    Checkpoint : models\marifindx_oil_segmentation.pt
echo    Metrics    : results\metrics.json
echo    Curves     : results\training_curve.png
echo.
echo  Start the app:
echo    uvicorn backend.main:app --reload
echo    npm run dev
echo ============================================================
exit /b 0

:failed
echo.
echo Training failed. See the output above.
exit /b 1
