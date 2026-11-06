import { useId } from 'react';
import { FileSpreadsheet, Layers, Settings2, TriangleAlert } from 'lucide-react';
import { NumberField } from '../ui/NumberField';
import { Tabs, TabPanel } from '../ui/Tabs';
import { StageEditor } from './StageEditor';
import { SweepPanel } from './SweepPanel';
import { ReadinessChecklist } from './ReadinessChecklist';
import { GAS_OPTIONS, gasDetail, isGasKey } from '../../utils/gasLabels';
import { VORTEX_EXPONENT_WARNING_MESSAGE } from '../../utils/bladeGeometry';
import {
  LOSS_MODELS,
  MIN_MASS_FLOW,
  MIN_P01_PA,
  MIN_T01_K,
  type DesignBlocker,
  type DesignField,
} from '../../utils/designState';
import type { TurbineDesignModel } from '../../hooks/useTurbineDesign';

export type InputsTab = 'operation' | 'geometry';

export const GLOBAL_FIELD_IDS = {
  gasKey: 'field-gas',
  lossModel: 'field-loss-model',
  m_dot: 'field-m-dot',
  P01: 'field-p01',
  T01: 'field-t01',
} as const;

export const INPUTS_TABS_ID = 'inputs';

const fmt = (value: number, digits: number) =>
  Number.isFinite(value) ? value.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

export interface InputsPanelProps {
  model: TurbineDesignModel;
  tab: InputsTab;
  onTabChange: (tab: InputsTab) => void;
  onSelectBlocker: (blocker: DesignBlocker) => void;
}

function OperatingConditions({ model }: { model: TurbineDesignModel }) {
  const { design, customEquations, blockers } = model;
  const { globalInputs, lossModel } = design;
  const gasHintId = useId();
  const errorOf = (field: DesignField) => blockers.find((blocker) => blocker.stageIndex === undefined && blocker.field === field)?.message;
  const gasError = errorOf('gasKey');

  return (
    <section aria-labelledby="conditions-title" className="space-y-3">
      <h3 id="conditions-title" className="text-label font-semibold text-ink">Condiciones de entrada</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={GLOBAL_FIELD_IDS.gasKey} className="text-label font-medium text-ink-2">Fluido de trabajo</label>
          <select
            id={GLOBAL_FIELD_IDS.gasKey}
            value={globalInputs.gasKey}
            onChange={(event) => {
              const value = event.target.value;
              model.setGlobalInput('gasKey', isGasKey(value) ? value : '');
            }}
            aria-describedby={gasHintId}
            aria-invalid={gasError ? true : undefined}
            className={`field h-10 w-full text-base sm:h-9 sm:text-sm ${gasError ? 'border-rose-400' : ''}`}
          >
            <option value="">Elige un fluido…</option>
            {GAS_OPTIONS.map((gas) => <option key={gas.key} value={gas.key}>{gas.label}</option>)}
          </select>
          <p id={gasHintId} className={`text-caption ${gasError ? 'text-danger' : 'text-ink-3'}`}>
            {gasError ?? gasDetail(globalInputs.gasKey)}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={GLOBAL_FIELD_IDS.lossModel} className="text-label font-medium text-ink-2">Modelo de pérdidas</label>
          <select
            id={GLOBAL_FIELD_IDS.lossModel}
            value={lossModel}
            onChange={(event) => {
              const selected = LOSS_MODELS.find((option) => option === event.target.value);
              if (selected) model.setLossModel(selected);
            }}
            className="field h-10 w-full text-base sm:h-9 sm:text-sm"
          >
            <option value="soderberg">Soderberg</option>
            <option value="ainley_mathieson">Ainley-Mathieson simplificado</option>
            <option value="user_defined" disabled={!customEquations.userDefinedLoss.enabled}>
              {customEquations.userDefinedLoss.name || 'Modelo propio'}
              {customEquations.userDefinedLoss.enabled ? '' : ' (actívalo en Ecuaciones)'}
            </option>
          </select>
        </div>

        <NumberField
          id={GLOBAL_FIELD_IDS.m_dot}
          label="Flujo másico"
          symbol="ṁ"
          unit="kg/s"
          value={globalInputs.m_dot > 0 ? globalInputs.m_dot : Number.NaN}
          min={MIN_MASS_FLOW}
          commitOnBlur
          max={1000}
          step={0.1}
          onChange={(value) => model.setGlobalInput('m_dot', value)}
          error={errorOf('m_dot')}
        />
        <NumberField
          id={GLOBAL_FIELD_IDS.P01}
          label="Presión total de entrada"
          symbol="P₀₁"
          unit="bar"
          value={globalInputs.P01 > 0 ? globalInputs.P01 / 1e5 : Number.NaN}
          min={MIN_P01_PA / 1e5}
          commitOnBlur
          max={300}
          step={0.1}
          onChange={(value) => model.setGlobalInput('P01', value * 1e5)}
          error={errorOf('P01')}
        />
        <NumberField
          id={GLOBAL_FIELD_IDS.T01}
          label="Temperatura total de entrada"
          symbol="T₀₁"
          unit="K"
          value={globalInputs.T01 > 0 ? globalInputs.T01 : Number.NaN}
          min={MIN_T01_K}
          commitOnBlur
          max={2500}
          step={10}
          typical="700–1700 K en turbinas de gas"
          onChange={(value) => model.setGlobalInput('T01', value)}
          error={errorOf('T01')}
        />
      </div>
    </section>
  );
}

function GeometrySummary({ model, onSelectBlocker }: { model: TurbineDesignModel; onSelectBlocker: (blocker: DesignBlocker) => void }) {
  const { activeResult, activeStage, activeBladeDesign, meridionalGeometry, statorGeometry, aspectRatioTarget, blockers } = model;

  if (!activeResult || !activeBladeDesign || !meridionalGeometry || !activeStage) {
    return (
      <div className="space-y-3">
        <p className="text-body text-ink-3">La geometría se calcula en cuanto el diseño está completo.</p>
        <ReadinessChecklist blockers={blockers} onSelect={onSelectBlocker} />
      </div>
    );
  }

  const rows: { label: string; value: string }[] = [
    ...(statorGeometry
      ? [
          { label: 'Álabes de estator', value: String(statorGeometry.bladeCount) },
          { label: 'Solidez de estator c/s', value: fmt(statorGeometry.solidity, 2) },
          { label: 'Paso de estator', value: `${fmt(statorGeometry.pitchMm, 1)} mm` },
        ]
      : []),
    { label: 'Álabes de rotor', value: String(activeBladeDesign.bladeCount_Z) },
    { label: 'Solidez de rotor c/s', value: fmt(activeBladeDesign.solidity_mid, 2) },
    { label: 'Paso de rotor', value: `${fmt(activeBladeDesign.pitch_mid_mm, 1)} mm` },
    { label: 'Alargamiento AR (h/c)', value: fmt(aspectRatioTarget, 2) },
    { label: 'Relación buje/punta (rotor)', value: fmt(activeBladeDesign.R_hub_mm / activeBladeDesign.R_tip_mm, 3) },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-label font-semibold text-ink">Geometría meridional · {activeStage.name}</h3>
        <p className="mt-1 text-caption text-ink-3">
          Alturas y radios por continuidad con la densidad y la velocidad axial de cada estación. Cuerda con AR = h/c ={' '}
          {fmt(aspectRatioTarget, 2)}.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[380px] text-label tabular-nums">
          <caption className="sr-only">Geometría meridional por estación de {activeStage.name}</caption>
          <thead className="bg-surface-muted text-ink-3">
            <tr>
              <th scope="col" className="px-2 py-2 text-left font-semibold">Estación</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">h (mm)</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">R buje (mm)</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">R punta (mm)</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">c (mm)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-ink-2">
            {meridionalGeometry.map((station) => (
              <tr key={station.label}>
                <th scope="row" className="px-2 py-2 text-left font-normal">{station.label}</th>
                <td className="px-2 py-2 text-right">{fmt(station.height * 1000, 1)}</td>
                <td className="px-2 py-2 text-right">{fmt(station.hubRadius * 1000, 1)}</td>
                <td className="px-2 py-2 text-right">{fmt(station.tipRadius * 1000, 1)}</td>
                <td className="px-2 py-2 text-right">{fmt(station.chord * 1000, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-label">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-ink-3">{row.label}</dt>
            <dd className="text-right font-semibold tabular-nums text-ink">{row.value}</dd>
          </div>
        ))}
        <dt className="text-ink-3">Cierre pérdidas-geometría</dt>
        <dd className={`text-right font-semibold ${activeResult.geometryLossConverged ? 'text-ok' : 'text-warn'}`}>
          {activeResult.geometryLossConverged
            ? `Convergido · ${activeResult.geometryLossIterations} iter.`
            : `Sin converger · ${activeResult.geometryLossIterations} iter.`}
        </dd>
      </dl>

      {activeBladeDesign.vortexExponentWarning && (
        <p role="note" className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-label text-warn">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {VORTEX_EXPONENT_WARNING_MESSAGE}
        </p>
      )}

      <div className="space-y-2">
        <p className="text-label font-semibold text-ink">Coordenadas del álabe (buje, medio y punta)</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => model.downloadBladeCsv('cad')}
            className="btn-secondary"
            title="Separador coma y punto decimal: ANSYS TurboGrid, OpenFOAM, CAD"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            CSV para CAD
          </button>
          <button
            type="button"
            onClick={() => model.downloadBladeCsv('excel')}
            className="btn-secondary"
            title="Separador punto y coma y coma decimal: se abre en columnas en Excel en español"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            CSV para Excel
          </button>
        </div>
      </div>

      <p className="border-t border-line pt-3 text-caption text-ink-3">
        El cierre recalcula alturas, cuerda, pérdidas y estados termodinámicos hasta converger. El visor 3D usa placas
        extruidas con espesor solo visual: no es el perfil aerodinámico ni incluye torsión radial.
      </p>
    </div>
  );
}

export function InputsPanel({ model, tab, onTabChange, onSelectBlocker }: InputsPanelProps) {
  return (
    <div className="rounded-card border border-line bg-surface shadow-card">
      <div className="border-b border-line p-2">
        <Tabs<InputsTab>
          idBase={INPUTS_TABS_ID}
          label="Entradas del diseño"
          value={tab}
          onChange={onTabChange}
          items={[
            { id: 'operation', label: 'Operación', icon: <Settings2 className="h-4 w-4" aria-hidden="true" /> },
            { id: 'geometry', label: 'Geometría', icon: <Layers className="h-4 w-4" aria-hidden="true" /> },
          ]}
        />
      </div>
      <TabPanel idBase={INPUTS_TABS_ID} id="operation" active={tab === 'operation'} className="divide-y divide-line">
        <div className="p-4">
          <OperatingConditions model={model} />
        </div>
        <div className="p-4">
          <StageEditor model={model} />
        </div>
        <div className="p-4">
          <SweepPanel model={model} />
        </div>
      </TabPanel>
      <TabPanel idBase={INPUTS_TABS_ID} id="geometry" active={tab === 'geometry'} className="p-4">
        <GeometrySummary model={model} onSelectBlocker={onSelectBlocker} />
      </TabPanel>
    </div>
  );
}

export default InputsPanel;
