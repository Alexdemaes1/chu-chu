/**
 * Documentación del modelo 1D de turbina axial.
 * Las ecuaciones describen la implementación actual; las correlaciones de
 * pérdidas y la geometría de perfil son estimaciones de prediseño.
 */

export type DocCategory = 'method' | 'thermo' | 'kinematics' | 'losses' | 'sizing' | 'geometry' | 'multistage' | 'fluids';

export interface DocSection {
  id: string;
  category: DocCategory;
  title: string;
  subtitle: string;
  tag: string;
  summary: string;
  equations: { name: string; formula: string; description: string }[];
  details: string[];
  designTips: string[];
  references: string[];
}

export const DOC_CATEGORIES: { id: DocCategory; label: string }[] = [
  { id: 'method', label: 'Alcance y supuestos' },
  { id: 'fluids', label: 'Fluido de trabajo' },
  { id: 'thermo', label: 'Termodinámica' },
  { id: 'kinematics', label: 'Triángulos y Euler' },
  { id: 'losses', label: 'Pérdidas' },
  { id: 'sizing', label: 'Canal anular' },
  { id: 'geometry', label: 'Álabes y geometría' },
  { id: 'multistage', label: 'Varias etapas' },
];

export const TURBINE_DOCUMENTATION: DocSection[] = [
  {
    id: 'model-scope', category: 'method', title: 'Qué calcula el modelo',
    subtitle: 'Alcance, secuencia de cálculo y límites de uso', tag: 'Leer primero',
    summary: 'La app estima una turbina axial mediante un modelo de línea media 1D y genera una geometría conceptual de álabe. No resuelve el campo tridimensional ni sustituye el análisis CFD, estructural o la validación experimental.',
    equations: [
      { name: 'Entradas de operación y diseño', formula: 'ṁ, P₀,in, T₀,in, N, P_obj,eje, R, intervalos de φ y ψ', description: 'El prediseño fija condiciones de operación, velocidad, potencias objetivo y reacción. El trabajo y el radio medio se derivan; φ y ψ se exploran en el barrido.' },
      { name: 'Escala dimensional por potencia', formula: 'P_total = ṁ Σᵢ ψᵢ(ωᵢ Rₘ)²  ⇒  Rₘ = √[P_total/(ṁ Σᵢ ψᵢωᵢ²)]', description: 'Para el modelo actual se supone un radio medio común a todas las filas. P_total es la suma de los objetivos de potencia de los ejes y ωᵢ=2πNᵢ/60.' },
      { name: 'Flujo de prediseño', formula: 'R fijado → barrido (φ,ψ) → radio y trabajo → triángulos → termodinámica → geometría → pérdidas → ηₜₜ', description: 'Para cada pareja φ–ψ se deriva Rₘ a partir de ṁ y las potencias objetivo, se cierra la expansión compatible con las pérdidas y se recalculan todas las filas.' },
      { name: 'Cierre por carga', formula: 'ψ = Δh₀ / |U|²;   Δh₀ = ηₜₜ Δh_is f_Euler;   PRₜₜ = (T₀,in/T₀,out,s)^(γ/(γ−1))', description: 'En el barrido se busca por bisección el PR cuya solución iterativa reproduzca ψ. f_Euler es el multiplicador configurable de trabajo (1 por defecto).' },
    ],
    details: [
      'Se usa gas ideal caloríficamente perfecto: γ, R y Cp son constantes durante el cálculo. El hidrógeno se modela como gas ideal; no como líquido criogénico.',
      'El solver de operación es axial. Las fórmulas y salidas de esta documentación no describen el diseño de turbinas radiales.',
      'Las correlaciones de pérdida son aproximadas y dependen de hipótesis geométricas simplificadas. La vista actual muestra álabes como placas rectas extruidas, sin perfil aerodinámico.',
      'El optimizador actual barre una etapa/fila cada vez; las filas ya diseñadas conservan sus factores y las que aún no lo están arrancan en el centro de sus intervalos. El radio común se vuelve a derivar en cada candidato. El criterio es máximo rendimiento global total-total, con tolerancia de potencia por eje.',
      'El número de puntos es el número de valores muestreados para cada parámetro: n puntos en φ por n en ψ producen n² candidatos. Un radio común es una hipótesis de prediseño; más adelante podrá sustituirse por una distribución radial o por radios de fila independientes.',
      'Los límites numéricos (áreas, temperaturas, coeficientes y número de álabes) evitan resultados no finitos; no son leyes físicas ni criterios de diseño certificados.',
    ],
    designTips: ['Usa los resultados para comparar conceptos y detectar tendencias. Antes de congelar un diseño, valida propiedades, pérdidas, incidencia, holgura, estructura y funcionamiento fuera del punto de diseño.'],
    references: ['Dixon, S. L. & Hall, C. A. (2014). Fluid Mechanics and Thermodynamics of Turbomachinery, 7th ed.'],
  },
  {
    id: 'working-fluid', category: 'fluids', title: 'Fluido y gas ideal',
    subtitle: 'Propiedades constantes que alimentan las ecuaciones de estado y energía', tag: 'Propiedades',
    summary: 'El selector carga una tabla fija de γ, R y Cp. El código no calcula esas propiedades a partir de la composición, presión o temperatura y no consulta una base de datos de gas real.',
    equations: [
      { name: 'Ecuación de estado', formula: 'P = ρ R T   ⇔   ρ = P / (R T)', description: 'Relación de gas ideal para densidad estática. En la entrada, cuando se conoce el estado total, el solver deriva el estado estático mediante energía y la relación isentrópica.' },
      { name: 'Relación entre calores específicos', formula: 'γ = Cp / Cv     ;     Cp − Cv = R     ;     Cp = γ R / (γ − 1)', description: 'Identidad válida para un gas ideal caloríficamente perfecto. Los presets almacenan directamente los valores γ, R y Cp usados por el solver.' },
      { name: 'Velocidad local del sonido', formula: 'a = √(γ R T)', description: 'Se calcula con la temperatura estática local; después se usa para obtener Mach absoluto y relativo.' },
    ],
    details: [
      'Presets del código: aire (γ=1.400, R=287.05, Cp=1004.7); gas de combustión (1.333, 287.05, 1148); hidrógeno gaseoso ideal (γ=1.3975, R=4124, Cp=14498.84); vapor sobrecalentado (1.300, 461.5, 1999.8); CO₂ (1.280, 188.92, 863.6), en unidades SI.',
      'Los valores de Cp no se recalculan al cambiar T. Esto limita la fidelidad cuando Cp varía mucho con la temperatura, especialmente en gases calientes.',
      'El preset llamado sCO₂ conserva propiedades constantes de gas ideal y no representa adecuadamente el comportamiento real cerca del punto crítico.',
    ],
    designTips: ['Interpreta las propiedades como aproximaciones del punto de operación. Para cálculos de alta fidelidad harán falta propiedades dependientes del estado y, para criogenia, el modelo de fase correspondiente.'],
    references: ['NIST Chemistry WebBook, como referencia para propiedades; los valores del preset no se actualizan automáticamente desde NIST.'],
  },
  {
    id: 'stage-thermodynamics', category: 'thermo', title: 'Expansión y estados termodinámicos',
    subtitle: 'Del estado total de entrada al salto ideal y real de la etapa', tag: 'Paso 1 · Energía',
    summary: 'La relación PR se define como P₀,in/P₀,out. En evaluación directa se especifica; en diseño por factores se resuelve para que el trabajo real reproduzca el ψ buscado, con γ y Cp constantes.',
    equations: [
      { name: 'Exponente isentrópico', formula: 'e = (γ − 1) / γ', description: 'Exponente de la relación de presión-temperatura total para expansión isentrópica de gas ideal con calores específicos constantes.' },
      { name: 'Presión total de salida', formula: 'P₀,out = P₀,in / PRₜₜ', description: 'Presión total de salida; PR puede ser una entrada directa o el resultado del cierre por carga en el barrido de diseño.' },
      { name: 'Temperatura total isentrópica de salida', formula: 'T₀,out,s = T₀,in · (1 / PRₜₜ)^e', description: 'Temperatura de salida que tendría una expansión reversible entre las presiones totales especificadas.' },
      { name: 'Salto entálpico isentrópico', formula: 'Δh_is = Cp · (T₀,in − T₀,out,s)', description: 'Energía específica ideal disponible, en J/kg. Equivale a Cp T₀,in [1 − (1/PRₜₜ)^e].' },
      { name: 'Velocidad de expansión teórica', formula: 'C₀ = √(2 Δh_is)', description: 'Velocidad equivalente si todo el salto isentrópico se convirtiera en energía cinética.' },
      { name: 'Actualización del trabajo', formula: 'Δh₀,0 = 0.88 Δh_is;   Δh_obj = ηₜₜ Δh_is f_Euler;   Δh₀ ← Δh₀ + 0.65(Δh_obj − Δh₀)', description: 'El valor inicial 0.88 es una semilla numérica. Se actualiza con relajación (factor 0.65), hasta 30 iteraciones o tolerancia; luego se recalcula el estado final.' },
      { name: 'Temperatura total real de salida', formula: 'T₀,out = T₀,in − Δh₀ / Cp', description: 'Balance de energía adiabático con Cp constante y Δh₀ como trabajo específico extraído.' },
      { name: 'Potencia y par de una etapa', formula: 'P = ṁ Δh₀     ;     τ = sgn · P / ω', description: 'P se expresa en W antes de convertir a kW o MW; el par conserva el signo de giro del rotor.' },
      { name: 'Grupos de similitud de Balje calculados', formula: 'Ns = ω√Q₃ / Δh_is^(3/4)     ;     Ds = 2Rₘ Δh_is^(1/4) / √Q₃', description: 'Se calculan con el caudal volumétrico de salida Q₃ y el salto isentrópico. Se usan para ubicar el punto en la visualización de similitud; la app no resuelve un mapa de eficiencia universal a partir de ellos.' },
    ],
    details: [
      'PRₜₜ > 1 representa expansión. El solver de la etapa no deduce PR a partir de la geometría: recibe PR como entrada.',
      'La eficiencia usada en la iteración es la del modelo seleccionado (Soderberg o Ainley–Mathieson simplificado). Como las pérdidas dependen de velocidades y estados, el cálculo es iterativo.',
      'El trabajo de Euler es una comprobación cinemática del intercambio de momento angular. Con la formulación axial base coincide con Δh₀; factores personalizados o acoplamiento pueden modificar esa relación.',
    ],
    designTips: ['Revisa que el estado calculado permanezca dentro de un rango físico y que la estimación de eficiencia no esté dominada por los límites numéricos de las correlaciones.'],
    references: ['Dixon & Hall (2014), capítulos de termodinámica y turbinas; Horlock (1966), Axial Flow Turbines.'],
  },
  {
    id: 'velocity-triangles', category: 'kinematics', title: 'Triángulos de velocidad y Euler',
    subtitle: 'Relación entre flujo absoluto, flujo relativo y movimiento del rotor', tag: 'Paso 2 · Cinemática',
    summary: 'El modelo usa una velocidad axial uniforme y un radio medio. Los ángulos se miden desde el eje axial; el signo tangencial depende del sentido de giro.',
    equations: [
      { name: 'Velocidad angular y periférica', formula: 'ω = 2πN / 60     ;     U = sgn · ω Rₘ', description: 'N se introduce en RPM. El signo sgn vale +1 o −1; la magnitud de U se usa para los coeficientes.' },
      { name: 'Velocidad axial', formula: 'φ = Vₐ / |U|     ;     Vₐ = φ |U|', description: 'φ es el coeficiente de flujo especificado. Si falta en la entrada interna, el solver usa 0.55; la interfaz permite introducirlo explícitamente.' },
      { name: 'Coeficiente de carga', formula: 'ψ = Δh₀ / |U|²', description: 'En el barrido, ψ es una decisión de diseño. El trabajo resultante define los triángulos y sirve para encontrar la expansión compatible con las pérdidas.' },
      { name: 'Remolino absoluto en el modelo axial', formula: 'Vθ₁ = sgn |U| [(1 − R) + ψ/2]     ;     Vθ₂ = sgn |U| [(1 − R) − ψ/2]', description: 'Cierre de triángulos para el grado de reacción R y carga ψ. En acoplamiento sin álabes, Vθ₁ se toma de la salida de la etapa anterior.' },
      { name: 'Velocidad relativa', formula: 'Wθ = Vθ − U     ;     Wₐ = Vₐ', description: 'Transformación de referencia entre el flujo absoluto y el rotor móvil.' },
      { name: 'Módulos y ángulos', formula: 'V = √(Vₐ² + Vθ²)     ;     W = √(Vₐ² + Wθ²)     ;     α = atan2(Vθ,Vₐ)     ;     β = atan2(Wθ,Vₐ)', description: 'atan2 conserva el cuadrante del ángulo; α es absoluto y β relativo.' },
      { name: 'Euler, reacción y Mach', formula: 'Δh_E = U(Vθ₁ − Vθ₂)     ;     R_calc = 1 − (Vθ₁ + Vθ₂)/(2U)     ;     M = V/a     ;     M_rel = W/a', description: 'Euler expresa el trabajo específico ideal. La reacción calculada es una comprobación del triángulo; Mach usa la temperatura estática de la estación correspondiente.' },
    ],
    details: [
      'El solver reporta la velocidad periférica con signo, pero algunos KPI muestran |U|. Esto explica diferencias de signo entre visualizaciones y ecuaciones vectoriales.',
      'La definición de reacción supone Va constante y el modelo de triángulos adoptado. No equivale a resolver una distribución radial de entalpía estática.',
      'La velocidad del sonido se calcula como a=√(γRT) usando T estática local; M_rel de entrada usa W₁/a₂ y de salida W₂/a₃ según la nomenclatura interna de estaciones.',
    ],
    designTips: ['Examina ambos triángulos y Mach relativo al variar R, φ, N y PR; una única cifra de rendimiento no revela por sí sola una entrada supersónica o una carga excesiva.'],
    references: ['Dixon & Hall (2014). Fluid Mechanics and Thermodynamics of Turbomachinery; NASA SP-290 (1972).'],
  },
  {
    id: 'soderberg-loss', category: 'losses', title: 'Pérdidas de Soderberg',
    subtitle: 'Correlación compacta aplicada a las cascadas fija y móvil', tag: 'Modelo 1 · Empírico',
    summary: 'La implementación usa una correlación nominal y factores de relación de aspecto distintos para estator y rotor. Es una aproximación empírica de prediseño, no un modelo universal de cascada.',
    equations: [
      { name: 'Pérdida nominal', formula: 'ζ₀ = 0.04 + 0.06(ε/100)²', description: 'Correlación publicada para t/c = 0.20, Re = 10⁵ y AR = 3. ε es el giro en grados: en el rotor ε = |β₂ − β₁| y en el estator ε = |α₁ − α₀|. En la primera etapa α₀ = 0; en las siguientes, α₀ sale del remolino de la fila anterior. La forma editable es a + b(ε/100)^c − t_k(t/c)/0.20, con t_k = 0 por defecto.' },
      { name: 'Corrección por relación de aspecto', formula: 'AR = h/c;   F_N = 0.993 + 0.021/AR;   F_R = 0.975 + 0.075/AR', description: 'El coeficiente final es ζ = max[0, (1+ζ₀)F − 1]. En ejecución AR se limita a [0.6, 8] antes de entrar en esta correlación. Las cuatro constantes (d, e del rotor; dStator, eStator del estator) son editables y la forma es la misma con los valores por defecto y con los personalizados.' },
      { name: 'Pérdida de estator y rotor', formula: 'Δh_loss,N = ζ_N V₁²/2     ;     Δh_loss,R = ζ_R W₂²/2', description: 'La fila fija usa velocidad absoluta de salida V₁; la fila móvil usa velocidad relativa de salida W₂. En una etapa marcada vaneless la pérdida de estator se hace cero.' },
      { name: 'Rendimiento total-total de la iteración', formula: 'ηₜₜ = clamp[1 − (Δh_loss,N + Δh_loss,R)/Δh_is, 0, 1]', description: 'Esta eficiencia alimenta la iteración del salto real. clamp limita el resultado a [0,1].' },
      { name: 'Rendimiento total-estático reportado', formula: 'η_ts = Δh₀ / {Cp T₀,in [1 − (P₃/P₀,in)^((γ−1)/γ)]}', description: 'Al final, el solver sustituye la estimación interna inicial de η_ts por la eficiencia respecto a la presión estática real de salida P₃.' },
    ],
    details: [
      'La correlación nominal y los factores de fila se evalúan mediante la función común de ecuaciones personalizables. El editor puede sustituir parámetros o expresiones.',
      'La implementación no modela explícitamente correcciones completas de Reynolds, Mach, rugosidad, incidencia, separación, bloqueo ni holgura de punta.',
      'La energía cinética de salida V₂²/2 se informa aparte como energía residual; no se resta directamente de ηₜₜ.',
    ],
    designTips: ['Usa la pérdida como tendencia comparativa. Para un perfil real hacen falta geometría de cascada, incidencia, Reynolds, Mach y holgura verificados.'],
    references: ['Soderberg, C. R. (1949). Notes on gas turbine design, MIT Gas Turbine Laboratory; Horlock (1966). Axial Flow Turbines.'],
  },
  {
    id: 'ainley-mathieson-loss', category: 'losses', title: 'Estimación inspirada en Ainley–Mathieson',
    subtitle: 'Aproximación algebraica de pérdidas de perfil, secundarias y de punta', tag: 'Modelo 2 · Simplificado',
    summary: 'El método bibliográfico original se apoya en mapas y correcciones empíricas. Esta app usa otra formulación algebraica simplificada con constantes editables; no debe interpretarse como una implementación íntegra de Ainley–Mathieson.',
    equations: [
      { name: 'Ángulo medio y carga de fila', formula: 'tan βₘ = [tan β₁ + tan β₂]/2;   C_L/(s/c) = 2|tan β₁ − tan β₂| cos βₘ', description: 'Se calcula de forma análoga para el estator con α₀ y α₁. Los ángulos se convierten de grados a radianes antes de evaluar seno, coseno y tangente.' },
      { name: 'Pérdida de perfil del rotor', formula: 'Yp_N = A_N + B_N(|β₂|/100)^2.4(s/c)^−0.4;   Yp_I = A_I + B_I(|β₂|/100)^2.6(s/c)^−0.6', description: 'Constantes por defecto: A_N=0.025, B_N=0.065, A_I=0.075, B_I=0.165.' },
      { name: 'Interpolación y espesor del rotor', formula: 'ξ = clamp[−sgn(β₂)·β₁/max(1,|β₂|), 0, 1];   Yp = clamp{[Yp_N + ξ²(Yp_I−Yp_N)](t/c/0.20)^ξ, 0.015, 0.25}', description: 'ξ conserva el signo del ángulo de entrada: β₁ = −β₂ es un álabe de impulso (ξ = 1) y β₁ = 0 una tobera (ξ = 0). Si β₁ está del mismo lado que β₂ (álabe de reacción que acelera el flujo) se toma la pérdida de tobera, ξ = 0, que es la opción conservadora. Es la transición algebraica usada por el código; no es el mapa de interpolación original del método.' },
      { name: 'Pérdida secundaria (Dunham-Came)', formula: 'Ys = clamp{(K_s/AR)[C_L/(s/c)]² cos²β₂ / max[0.02, cos³βₘ] · |cos β₂| / max[0.05, |cos β₁|], 0, 0.25}', description: 'Incluye el factor cos(salida)/cos(entrada) de Dunham & Came (1970); en el estator es cos α₁/cos α₀. K_s = 0.033 por defecto (Dunham & Came publican 0.0334); el máximo del estator se limita a 0.20. AR = h/c.' },
      { name: 'Pérdida de perfil del estator', formula: 'ξ_N = clamp[−sgn(α₁)·α₀/max(1,|α₁|), 0, 1];   Yp = clamp{[Yp_N + ξ_N²(Yp_I−Yp_N)](t/c/0.20)^ξ_N, 0.015, 0.25}', description: 'La misma interpolación tobera-impulso que el rotor, con α₀ y α₁ en lugar de β₁ y β₂ (Yp_N e Yp_I se evalúan con |α₁|). Sin remolino de entrada (α₀ = 0) queda la expresión de tobera; un remolino α₀ de signo contrario a α₁, como el que deja una etapa anterior, hace la fila en parte de impulso.' },
      { name: 'Pérdida por holgura del rotor', formula: 'Ytc = clamp{B_tip(k/h)[C_L/(s/c)]² cos²β₂ / max[0.02, cos³βₘ], 0, 0.12}', description: 'B_tip=0.50 por defecto; k/h es la holgura relativa.' },
      { name: 'Conversión a pérdidas de entalpía', formula: 'r = [1 + (γ−1)M²/2]^(γ/(γ−1));   p₀₁/p₂ = r + Y(r − 1);   ζ = [T₂/T₀ − (p₂/p₀₁)^((γ−1)/γ)] / (1 − T₂/T₀);   Δh_loss = ζ V²/2 o ζ W²/2', description: 'Relación exacta de gas ideal entre Y = (p₀₁−p₀₂)/(p₀₂−p₂) y ζ = (h₂−h₂s)/(V₂²/2), con T₂/T₀ = 1/[1 + (γ−1)M²/2] y Ytot = Yp + Ys (+ Ytc). Para M → 0 da ζ = Y; con γ = 1.333 e Y = 0.1 da ζ ≈ 0.090 a M = 0.5 y ζ ≈ 0.072 a M = 0.9. El estator usa el Mach absoluto de salida y V₁; el rotor, el Mach relativo de salida y W₂. Si la fila fija es vaneless, sus términos de pérdida se anulan.' },
      { name: 'Eficiencia total-total', formula: 'ηₜₜ = clamp[1 − (Δh_loss,N + Δh_loss,R)/Δh_is, 0, 1]', description: 'Se devuelve al lazo que reconcilia pérdidas, triángulos y salto de entalpía.' },
    ],
    details: [
      'El código limita s/c a [0.45,1.35], t/c a [0.10,0.28] y AR a [0.6,8]. Las pérdidas Yp, Ys y Ytc también tienen cotas para mantener estable el cálculo.',
      'El ángulo de entrada del estator α₀ interviene en su pérdida de perfil (fracción de impulso ξ_N), en su carga C_L y en su pérdida secundaria. La expresión propia del estator recibe Yp_base, Yp_nozzle, Yp_impulse, xi, xi_signed, alpha0 y alpha1.',
      'Con R = 0.5 los triángulos son simétricos (α₁ = −β₂ y α₀ = −β₁ cuando la etapa se repite) y la pérdida de perfil del rotor coincide con la del estator, también con remolino de entrada y ψ > 1.',
      'Incidencia, número de Reynolds y los mapas originales de Mach/ángulo no se resuelven aquí. Las constantes por defecto son parámetros de una estimación propia de baja fidelidad.',
    ],
    designTips: ['La etiqueta “simplificado” es deliberada. Compara tendencias y sensibilidad; no uses ηₜₜ como rendimiento certificado o garantizado.'],
    references: ['Ainley & Mathieson (1951), ARC R&M 2891; Dunham & Came (1970), ASME Journal of Engineering for Power; Kacker & Okapuu (1982), ASME Journal of Engineering for Power. Estas publicaciones son contexto, no equivalencia exacta de la implementación.'],
  },
  {
    id: 'annulus-sizing', category: 'sizing', title: 'Caudal, continuidad y canal anular',
    subtitle: 'Conversión del estado de salida en área y altura de paso', tag: 'Paso 3 · Tamaño',
    summary: 'La altura del álabe se estima en la salida del rotor (estación 3) a partir del caudal volumétrico, la densidad calculada y Va, y se usa para las dos filas. Se usa un anillo de área aproximada 2πRₘh.',
    equations: [
      { name: 'Estado estático en una estación', formula: 'T = T₀ − V²/(2Cp);   P = P₀(T/T₀)^(γ/(γ−1));   ρ = P/(RT)', description: 'El solver aplica la ecuación de energía con Cp constante a cada estación. En la entrada del estator V₀² = Vₐ² + Vθ₀². En la salida del rotor la presión estática se obtiene de la presión total de salida P₀₃. En algunas variables intermedias impone pisos numéricos de temperatura.' },
      { name: 'Presión a la salida del estator', formula: 'T₂ = T₀₁ − V₁²/(2Cp);   T₂s = T₂ − Δh_loss,N/Cp;   P₂ = P₀₁(T₂s/T₀₁)^(γ/(γ−1))', description: 'La pérdida del estator del modelo activo no cambia T₂ (la entalpía total se conserva), pero reduce P₂ respecto a la expansión isentrópica. Con el modelo de pérdidas propio, que solo da la fracción de pérdida de la etapa, se usa la pérdida de estator de Soderberg. Sin estator (fila contrarrotativa o vaneless) P₂ es la isentrópica.' },
      { name: 'Caudal volumétrico de salida', formula: 'Q₃ = ṁ / ρ₃', description: 'Relación entre caudal másico y densidad estática de salida.' },
      { name: 'Área ideal requerida', formula: 'A_ideal = Q₃ / max(Vₐ, 10 m/s)', description: 'Continuidad ṁ=ρVA, usando Va como velocidad meridional uniforme y un límite numérico inferior de 10 m/s.' },
      { name: 'Bloqueo y área efectiva', formula: 'A_eff = A_ideal / (1 − K_b)', description: 'K_b es el factor de bloqueo de capa límite configurable (0 por defecto). Así se aumenta el área geométrica para compensar la fracción bloqueada.' },
      { name: 'Altura anular y radios', formula: 'A_eff ≈ 2πRₘ h;   h = A_eff/(2πRₘ);   r_h = max(0.005, Rₘ−h/2);   r_t = Rₘ+h/2', description: 'Para un anillo con radio medio aritmético Rₘ, el área exacta π(r_t²−r_h²) es igual a 2πRₘh. El código limita el radio de buje a 5 mm.' },
      { name: 'Relación de buje a punta y criterio 2D', formula: 'HTR = r_h/r_t;   HTR > 0.80 → se admite flujo bidimensional;   HTR ≤ 0.80 → equilibrio radial relevante', description: 'Las diapositivas de teoría axial consideran despreciable la velocidad radial si la relación raíz/punta supera el 80%. El filtro de optimización exige HTR>0.80 en todas las filas. Es un criterio de aplicabilidad del modelo, no una resolución de las ecuaciones de equilibrio radial.' },
    ],
    details: [
      'La continuidad usa la Va del modelo de velocidad uniforme; no integra el perfil radial ni corrige contracción, fugas o distribución de bloqueo.',
      'La altura puede depender de la iteración termodinámica porque ρ₃ depende de T₃ y P₃, que a su vez dependen del salto real.',
    ],
    designTips: ['Comprueba sensibilidad de h y HTR ante caudal, radio, presión y temperatura. La hipótesis bidimensional de estas diapositivas requiere HTR>0.80; por debajo, incluye el equilibrio radial para representar la variación radial del flujo.'],
    references: ['Turbomáquinas Térmicas, Tema 6: Equilibrio radial, diapositivas 4–5 (criterio HTR=0.80); Dixon & Hall (2014), continuidad y dimensionamiento; Saravanamuttoo et al., Gas Turbine Theory.'],
  },
  {
    id: 'blade-geometry', category: 'geometry', title: 'Dimensionamiento y torsión del álabe',
    subtitle: 'Cuerda, solidez, número de álabes y variación radial de los triángulos', tag: 'Paso 4 · Geometría',
    summary: 'Con el canal anular definido, la herramienta obtiene cuerda, paso, solidez y número de álabes para cada fila. La visualización aún no crea perfiles aerodinámicos.',
    equations: [
      { name: 'Cuerda axial derivada', formula: 'c_ax = h / AR;   AR = AR_objetivo (1.6 por defecto)', description: 'La altura h se obtiene por continuidad en cada estación. La cuerda sale de la relación de aspecto configurada; no se pide como entrada geométrica.' },
      { name: 'Espesor asumido por las pérdidas', formula: 't_max/c_ax = 0.20', description: 'Hipótesis para las correlaciones de pérdidas. No define el espesor de las placas rectas que se muestran en 3D.' },
      { name: 'Ley radial de remolino', formula: 'Vθ(r) rⁿ = Vθ,mid Rₘⁿ;   Vₐ(r)=Vₐ,mid;   U(r)=ωr', description: 'El exponente n se puede editar en el árbol de ecuaciones (n=1 corresponde a vórtice libre). Esto prescribe los triángulos radiales; no resuelve por completo el equilibrio radial ni el gradiente de presión.' },
      { name: 'Triángulos y ángulos radiales', formula: 'Wθ,i(r)=Vθ,i(r)−U(r);   β_i(r)=atan2[Wθ,i(r),Vₐ]', description: 'Se evalúa para buje, radio medio y punta; así se obtiene una torsión aproximada del álabe.' },
      { name: 'Paso óptimo de Zweifel en radio medio', formula: 's_ideal = ψ_Z c_ax / {2 cos²β₂ · |tanβ₁−tanβ₂|}', description: 'β₁ y β₂ son ángulos de flujo relativo en el radio medio. Se limita cos²β₂ a 0.08; el giro no tiene un límite inferior artificial.' },
      { name: 'Número de álabes y paso real', formula: 'Z = clamp(round(2πRₘ/s_ideal),12,180);   s(r)=2πr/Z;   solidez_mid=c_ax/s_mid', description: 'Se calcula automáticamente con los triángulos y el criterio Zweifel configurado. Al redondear Z entero, el paso real puede apartarse del ideal.' },
      { name: 'Ángulos metálicos y calado', formula: 'β_metal,1=β_flow,1+i;   β_metal,2=β_flow,2−δ;   γ_stagger=0.45β_metal,1+0.55β_metal,2', description: 'Incidencia i=0° y desviación δ=3° por defecto. El calado ponderado define la orientación del perfil geométrico.' },
    ],
    details: [
      'La geometría meridional se reconstruye en las estaciones de entrada, salida del estator/entrada del rotor y salida del rotor a partir de ρ y Va. El cierre iterativo de la etapa vuelve a calcular el área de salida y las pérdidas hasta converger (máximo 30 iteraciones).',
      'Las cuerdas de las cascadas se derivan con la relación h/c configurada (1.6 por defecto). El valor de relación de aspecto es una hipótesis de diseño, no una magnitud que salga de la termodinámica.',
      'El espesor 0.20c es una hipótesis temporal del modelo de pérdidas; no es el espesor visual ni el diseño de un perfil. Las protecciones en s_ideal y límites de Z pueden apartar el paso final del objetivo Zweifel.',
    ],
    designTips: ['Revisa el paso real, la solidez y las tres secciones tras el redondeo. La desviación fija de 3° y las proporciones de espesor son hipótesis geométricas, no resultados de una correlación validada de cascada.'],
    references: ['Zweifel, O. (1945). The spacing of turbomachine blading, especially with large angular deflection. Brown Boveri Review, 32(12), 436–444; Lakshminarayana (1996), Fluid Dynamics and Heat Transfer of Turbomachinery.'],
  },
  {
    id: 'straight-extrusion', category: 'geometry', title: 'Extrusión recta de los álabes',
    subtitle: 'Representación conceptual sin perfil aerodinámico', tag: 'Paso 5 · Geometría visual',
    summary: 'La vista 3D representa cada álabe como una placa recta que se repite alrededor del eje. Estator y rotor usan por separado el conteo y las dimensiones calculadas para cada fila.',
    equations: [
      { name: 'Dimensiones de la placa', formula: 'b_radial = h;   b_axial = c_ax;   t_visual = max(1 mm, 0.03 c_ax)', description: 'La placa se extruye radialmente. El espesor es una escala visual, no un parámetro estructural.' },
      { name: 'Distribución circunferencial', formula: 'θᵢ = 2πi/Z;   i = 0,…,Z−1', description: 'Cada placa se instancia con separación angular uniforme usando el número Z calculado para su fila.' },
      { name: 'Separación visual entre filas', formula: 'Δz_visual = 1.3 c_ax,estator', description: 'El estator se desplaza axialmente para distinguirlo del rotor; esta distancia es de presentación y no un resultado de diseño.' },
    ],
    details: [
      'La vista no incluye curvatura, calado, perfil aerodinámico ni torsión radial.',
      'Los archivos STL representan estas extrusiones rectas y no son geometría final de fabricación.',
      'La generación de perfiles aerodinámicos se añadirá como una opción posterior.',
    ],
    designTips: ['Comprueba por separado el número de álabes y la solidez del estator y el rotor. Usa el 3D solo para revisar disposición y dimensiones relativas.'],
    references: ['La extrusión es una convención de visualización de la aplicación; el conteo usa el criterio de paso de Zweifel.'],
  },
  {
    id: 'multistage', category: 'multistage', title: 'Cálculo de varias etapas',
    subtitle: 'Encadenamiento de estados, potencia total y acoplamiento de remolino', tag: 'Conjunto',
    summary: 'Las filas se calculan en serie: una fila normal contiene estator + rotor y una fila contrarrotativa es solo rotor, que recibe el remolino de salida anterior.',
    equations: [
      { name: 'Estado de entrada de la etapa siguiente', formula: 'P₀,in,i+1 = P₀,out,i;   T₀,in,i+1 = T₀,out,i', description: 'El caudal másico y el gas se mantienen comunes a todas las etapas.' },
      { name: 'Tipo de fila', formula: 'Normal: estator + rotor; contrarrotativa: rotor solo', description: 'La fila rotor-solo hereda el remolino absoluto de la fila anterior y usa su velocidad de giro con signo. Su pérdida de estator es cero.' },
      { name: 'Relación de presión global', formula: 'PR_global = ∏ᵢ PRᵢ', description: 'Producto de las relaciones total-total de cada etapa.' },
      { name: 'Salto ideal global y factor de recalentamiento calculado', formula: 'Δh_is,global = CpT₀,1[1−(1/PR_global)^e];   Rf = ΣᵢΔh_is,i / Δh_is,global', description: 'Rf es una salida derivada de los estados de las etapas; el solver no permite fijarlo directamente como parámetro.' },
      { name: 'Potencia y par por eje', formula: 'P_eje,j = Σᵢ∈j ṁΔh₀,i;   τ_eje,j = Σᵢ∈j τ_i', description: 'Las potencias y pares se agregan por nombre de eje; no se interpreta la suma algebraica de pares de ejes independientes como un par neto físico.' },
      { name: 'Acoplamiento sin álabes', formula: 'Vθ₁,i+1 = Vθ₂,i', description: 'Cuando una etapa posterior se configura vaneless, el remolino absoluto de salida previo se impone como remolino de entrada; la pérdida de estator de esa fila se anula.' },
      { name: 'Entrada del estator en etapas con álabes fijos', formula: 'Vθ₀,i+1 = Vθ₂,i · Rₘ,i / Rₘ,i+1;   α₀ = atan2(Vθ₀, Vₐ);   ε_N = |α₁ − α₀|', description: 'Una fila normal (estator + rotor) que sigue a otra recibe su remolino de salida conservando el momento angular r·Vθ en el hueco entre filas. Así el estator gira el flujo desde α₀ y no desde la dirección axial; α₀ entra en Soderberg, en Ainley–Mathieson y en el estado estático de entrada.' },
    ],
    details: [
      'El cociente de recalentamiento se calcula a partir de los saltos isentrópicos individuales y el salto isentrópico total; puede diferir de 1 debido a la forma de encadenar estados.',
      'El acoplamiento es una transferencia simplificada de remolino. No modela mezcla, longitud de ducto, pérdidas de difusión ni redistribución radial interetapa.',
      'El programa permite mezclar filas normales y rotor-solo contrarrotativas, y mostrar potencia/par agrupados por eje. Las reglas de transmisión mecánica y tren de ejes no están modeladas.',
    ],
    designTips: ['Compara tanto el resultado global como las variables por etapa. Un buen resultado agregado puede ocultar una etapa individual con Mach, carga o geometría inadecuados.'],
    references: ['Cohen, Rogers & Saravanamuttoo (2001). Gas Turbine Theory, 5th ed.; Dixon & Hall (2014).'],
  },
];
