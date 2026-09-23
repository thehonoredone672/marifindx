@echo off
REM MariFindX - full training on the complete Zenodo corpus.
REM Expects a CUDA GPU and the full Part I + Part II data on disk.

setlocal
cd /d "%~dp0\.."

echo ============================================================
echo  MariFindX - FULL TRAINING
echo ============================================================
echo.
echo This uses every image found under data\raw and the pretrained
echo ResNet-34 encoder at 512px patches. On CPU this is impractical -
echo a CUDA GPU is strongly recommended.
echo.

python scripts\download_dataset.py --check
if errorlevel 1 (
    echo.
    echo Dataset check failed. Run:
    echo     python scripts\download_dataset.py --manual
    exit /b 1
)

echo.
set /p CONFIRM="Proceed with full training? [y/N]: "
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    exit /b 0
)

echo.
echo [1/2] Training...
python -m ml.train --config config.yaml --mode full --encoder resnet34 --patch-size 512
if errorlevel 1 goto :failed

echo.
echo [2/2] Evaluating on Part III...
python -m ml.test --config config.yaml
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo  Done.
echo    Checkpoint : models\marifindx_oil_segmentation.pt
echo    Metadata   : models\model_metadata.json
echo    Metrics    : results\metrics.json
echo    Qualitative: results\qualitative\
echo ============================================================
exit /b 0

:failed
echo.
echo Training failed. See the output above.
exit /b 1
