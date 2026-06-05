#!/bin/bash
# Genera análisis diario y lo guarda en daily-analysis/ con nombre de fecha

ANALYSIS_DIR="daily-analysis"
DATE=$(date +%Y-%m-%d)
OUTPUT_FILE="$ANALYSIS_DIR/ANALYSIS-$DATE.txt"

# Crear directorio si no existe
mkdir -p "$ANALYSIS_DIR"

# Generar análisis
echo "🔍 Analizando logs..."
node src/analyze-logs-daily.js > "$OUTPUT_FILE" 2>&1

# Mostrar resultado
echo ""
echo "✅ Análisis generado:"
echo "   📁 $OUTPUT_FILE"
echo ""
echo "📋 Contenido:"
cat "$OUTPUT_FILE"
echo ""
echo "📤 Listo para subir a Claude.ai"
