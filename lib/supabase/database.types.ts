export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          entity_id: string | null
          entity_type: string
          id: number
          occurred_at: string
          organization_id: string | null
          request_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: never
          occurred_at?: string
          organization_id?: string | null
          request_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: never
          occurred_at?: string
          organization_id?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          created_at: string
          created_by: string
          cta: string
          format: Database["public"]["Enums"]["content_format"]
          goal: string
          hook: string
          id: string
          organization_id: string
          platforms: string[]
          publish_at: string
          published_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string
          cta: string
          format?: Database["public"]["Enums"]["content_format"]
          goal: string
          hook: string
          id?: string
          organization_id: string
          platforms?: string[]
          publish_at: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          cta?: string
          format?: Database["public"]["Enums"]["content_format"]
          goal?: string
          hook?: string
          id?: string
          organization_id?: string
          platforms?: string[]
          publish_at?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_content_items: {
        Row: {
          content_item_id: string
          created_at: string
          created_by: string
          launch_id: string
          organization_id: string
        }
        Insert: {
          content_item_id: string
          created_at?: string
          created_by?: string
          launch_id: string
          organization_id: string
        }
        Update: {
          content_item_id?: string
          created_at?: string
          created_by?: string
          launch_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_content_items_content_item_id_organization_id_fkey"
            columns: ["content_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "launch_content_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_content_items_launch_id_organization_id_fkey"
            columns: ["launch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      launches: {
        Row: {
          audience: string
          created_at: string
          created_by: string
          currency: string
          ends_at: string
          id: string
          lead_target: number | null
          objective: string
          offer: string
          organization_id: string
          owner_id: string
          primary_cta: string
          revenue_target: number | null
          sales_target: number | null
          starts_at: string
          status: Database["public"]["Enums"]["launch_status"]
          title: string
          type: Database["public"]["Enums"]["launch_type"]
          updated_at: string
          version: number
        }
        Insert: {
          audience: string
          created_at?: string
          created_by?: string
          currency?: string
          ends_at: string
          id?: string
          lead_target?: number | null
          objective: string
          offer: string
          organization_id: string
          owner_id: string
          primary_cta: string
          revenue_target?: number | null
          sales_target?: number | null
          starts_at: string
          status?: Database["public"]["Enums"]["launch_status"]
          title: string
          type: Database["public"]["Enums"]["launch_type"]
          updated_at?: string
          version?: number
        }
        Update: {
          audience?: string
          created_at?: string
          created_by?: string
          currency?: string
          ends_at?: string
          id?: string
          lead_target?: number | null
          objective?: string
          offer?: string
          organization_id?: string
          owner_id?: string
          primary_cta?: string
          revenue_target?: number | null
          sales_target?: number | null
          starts_at?: string
          status?: Database["public"]["Enums"]["launch_status"]
          title?: string
          type?: Database["public"]["Enums"]["launch_type"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "launches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launches_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      task_dependencies: {
        Row: {
          created_at: string
          depends_on_task_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          depends_on_task_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          depends_on_task_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_events: {
        Row: {
          actor_id: string | null
          details: Json
          event_type: string
          from_status: Database["public"]["Enums"]["task_status"] | null
          id: number
          occurred_at: string
          organization_id: string
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"] | null
        }
        Insert: {
          actor_id?: string | null
          details?: Json
          event_type: string
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: never
          occurred_at?: string
          organization_id: string
          task_id: string
          to_status?: Database["public"]["Enums"]["task_status"] | null
        }
        Update: {
          actor_id?: string | null
          details?: Json
          event_type?: string
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: never
          occurred_at?: string
          organization_id?: string
          task_id?: string
          to_status?: Database["public"]["Enums"]["task_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "task_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          acceptance_criteria: string
          completed_at: string | null
          content_item_id: string | null
          content_step: Database["public"]["Enums"]["content_step"] | null
          created_at: string
          created_by: string
          description: string | null
          due_at: string
          id: string
          launch_gate: Database["public"]["Enums"]["launch_gate"] | null
          launch_id: string | null
          organization_id: string
          owner_id: string
          priority: Database["public"]["Enums"]["task_priority"]
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          acceptance_criteria: string
          completed_at?: string | null
          content_item_id?: string | null
          content_step?: Database["public"]["Enums"]["content_step"] | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at: string
          id?: string
          launch_gate?: Database["public"]["Enums"]["launch_gate"] | null
          launch_id?: string | null
          organization_id: string
          owner_id: string
          priority?: Database["public"]["Enums"]["task_priority"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          acceptance_criteria?: string
          completed_at?: string | null
          content_item_id?: string | null
          content_step?: Database["public"]["Enums"]["content_step"] | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string
          id?: string
          launch_gate?: Database["public"]["Enums"]["launch_gate"] | null
          launch_id?: string | null
          organization_id?: string
          owner_id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tasks_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_launch_id_organization_id_fkey"
            columns: ["launch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      attach_content_to_launch: {
        Args: {
          target_content_item_id: string
          target_launch_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      bootstrap_market_whales_organization: {
        Args: { target_user_id: string }
        Returns: string
      }
      create_launch_workflow: {
        Args: {
          delivery_owner_id: string
          go_no_go_owner_id: string
          launch_audience: string
          launch_cta: string
          launch_currency: string
          launch_day_owner_id: string
          launch_ends_at: string
          launch_kind: Database["public"]["Enums"]["launch_type"]
          launch_lead_target: number
          launch_objective: string
          launch_offer: string
          launch_revenue_target: number
          launch_sales_target: number
          launch_starts_at: string
          launch_title: string
          offer_owner_id: string
          promotion_owner_id: string
          registration_owner_id: string
          strategy_owner_id: string
          target_organization_id: string
          target_user_id: string
          tracking_owner_id: string
        }
        Returns: string
      }
      create_reel_workflow: {
        Args: {
          approval_owner_id: string
          brief_owner_id: string
          caption_owner_id: string
          content_cta: string
          content_goal: string
          content_hook: string
          content_title: string
          editing_owner_id: string
          publishing_owner_id: string
          recording_owner_id: string
          target_organization_id: string
          target_publish_at: string
          target_user_id: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      create_reel_workflow_internal: {
        Args: {
          approval_owner_id: string
          brief_owner_id: string
          caption_owner_id: string
          content_cta: string
          content_goal: string
          content_hook: string
          content_title: string
          editing_owner_id: string
          publishing_owner_id: string
          recording_owner_id: string
          target_organization_id: string
          target_publish_at: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      detach_content_from_launch: {
        Args: {
          target_content_item_id: string
          target_launch_id: string
          target_user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "manager" | "member" | "viewer"
      content_format:
        | "reel"
        | "carousel"
        | "post"
        | "story"
        | "long_video"
        | "live"
        | "email"
      content_status:
        | "planned"
        | "production"
        | "review"
        | "scheduled"
        | "published"
        | "cancelled"
      content_step:
        | "brief"
        | "recording"
        | "editing"
        | "thumbnail"
        | "caption"
        | "approval"
        | "publishing"
      launch_gate:
        | "strategy"
        | "offer"
        | "registration"
        | "delivery"
        | "promotion"
        | "tracking"
        | "go_no_go"
        | "launch_day"
      launch_status:
        | "planning"
        | "production"
        | "review"
        | "ready"
        | "live"
        | "completed"
        | "cancelled"
      launch_type: "webinar" | "course" | "service" | "book" | "indicator"
      membership_status: "invited" | "active" | "suspended"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status:
        | "backlog"
        | "ready"
        | "in_progress"
        | "review"
        | "blocked"
        | "done"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "manager", "member", "viewer"],
      content_format: [
        "reel",
        "carousel",
        "post",
        "story",
        "long_video",
        "live",
        "email",
      ],
      content_status: [
        "planned",
        "production",
        "review",
        "scheduled",
        "published",
        "cancelled",
      ],
      content_step: [
        "brief",
        "recording",
        "editing",
        "thumbnail",
        "caption",
        "approval",
        "publishing",
      ],
      launch_gate: [
        "strategy",
        "offer",
        "registration",
        "delivery",
        "promotion",
        "tracking",
        "go_no_go",
        "launch_day",
      ],
      launch_status: [
        "planning",
        "production",
        "review",
        "ready",
        "live",
        "completed",
        "cancelled",
      ],
      launch_type: ["webinar", "course", "service", "book", "indicator"],
      membership_status: ["invited", "active", "suspended"],
      task_priority: ["low", "normal", "high", "urgent"],
      task_status: [
        "backlog",
        "ready",
        "in_progress",
        "review",
        "blocked",
        "done",
        "cancelled",
      ],
    },
  },
} as const
