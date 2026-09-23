import { create } from 'zustand'
import api from '../services/api'

/**
 * Single source of truth for the active investigation.
 *
 * The 2D map, the 3D time-lapse, the ranking table and the summary all
 * read from this one record, so switching views can never show
 * contradictory numbers.
 */
export const useInvestigationStore = create((set, get) => ({
  investigation: null,
  loading: false,
  error: null,
  modelStatus: null,

  // Shared view state, preserved across the 2D <-> 3D toggle.
  selectedVesselId: null,
  viewMode: '3d',
  simulationTime: 0,
  isPlaying: false,
  playbackSpeed: 1,

  setViewMode: (viewMode) => set({ viewMode }),
  setSelectedVessel: (selectedVesselId) => set({ selectedVesselId }),
  setSimulationTime: (simulationTime) => set({ simulationTime }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  clearError: () => set({ error: null }),

  async checkModel() {
    try {
      const modelStatus = await api.modelStatus()
      set({ modelStatus })
      return modelStatus
    } catch (err) {
      set({ modelStatus: { checkpoint_present: false, unreachable: true } })
      throw err
    }
  },

  async runDemo() {
    set({ loading: true, error: null })
    try {
      const investigation = await api.runDemo()
      set({
        investigation,
        loading: false,
        simulationTime: 0,
        isPlaying: false,
        selectedVesselId:
          investigation?.ranking?.vessels?.[0]?.id ?? null,
      })
      return investigation
    } catch (err) {
      set({ loading: false, error: { message: err.message, detail: err.detail } })
      throw err
    }
  },

  async uploadScene(file) {
    set({ loading: true, error: null })
    try {
      const investigation = await api.uploadScene(file)
      set({
        investigation,
        loading: false,
        simulationTime: 0,
        isPlaying: false,
        selectedVesselId:
          investigation?.ranking?.vessels?.[0]?.id ?? null,
      })
      return investigation
    } catch (err) {
      set({ loading: false, error: { message: err.message, detail: err.detail } })
      throw err
    }
  },

  async loadInvestigation(id) {
    set({ loading: true, error: null })
    try {
      const investigation = await api.getInvestigation(id)
      set({
        investigation,
        loading: false,
        selectedVesselId:
          investigation?.ranking?.vessels?.[0]?.id ?? null,
      })
      return investigation
    } catch (err) {
      set({ loading: false, error: { message: err.message, detail: err.detail } })
      throw err
    }
  },

  // ---- derived selectors -------------------------------------------
  vessels: () => get().investigation?.ranking?.vessels ?? [],

  selectedVessel: () => {
    const { investigation, selectedVesselId } = get()
    const list = investigation?.ranking?.vessels ?? []
    return list.find((v) => v.id === selectedVesselId) ?? list[0] ?? null
  },

  driftFrames: () => get().investigation?.drift?.frames ?? [],

  /** Total simulated span in minutes, from release window to detection. */
  durationMinutes: () => {
    const sim = get().investigation?.simulation
    if (!sim?.start_time || !sim?.end_time) return 0
    const ms = new Date(sim.end_time) - new Date(sim.start_time)
    return Math.max(0, ms / 60000)
  },

  /** Absolute Date for the current simulation offset. */
  currentDate: () => {
    const sim = get().investigation?.simulation
    if (!sim?.start_time) return null
    return new Date(new Date(sim.start_time).getTime() + get().simulationTime * 60000)
  },
}))

export default useInvestigationStore
